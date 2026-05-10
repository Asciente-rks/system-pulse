import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import * as yup from "yup";
import { docClient } from "../../config/db.js";
import { handleError, headers, HttpError } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { isSuperAdmin } from "../../utils/rbac.js";
import {
  getActorUserId,
  rejectIfDemo,
  requireAdminActorPassword,
} from "../../utils/actor-auth.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { sendStatusChangeEmail } from "../../services/email-service.js";

const ORG_DELETE_REASONS = [
  "Owner requested deletion",
  "Policy violation - permanent",
  "Account migration",
  "Inactive cleanup",
  "Other",
] as const;

const deleteBodySchema = yup.object({
  actorPassword: yup
    .string()
    .required("Your password is required")
    .max(256, "Password is too long"),
  reason: yup
    .mixed<(typeof ORG_DELETE_REASONS)[number]>()
    .oneOf([...ORG_DELETE_REASONS])
    .required("A reason is required"),
  notes: yup
    .string()
    .max(2000, "Notes too long")
    .optional(),
});

interface DeleteBody {
  actorPassword: string;
  reason: (typeof ORG_DELETE_REASONS)[number];
  notes?: string;
}

/**
 * DELETE /orgs/:id — superadmin-only hard delete with cascade.
 *
 * Order of operations matters: we email the owner FIRST (so we
 * still have their email), then nuke users + systems + logs + the
 * org record. Failures partway through leave the platform in an
 * inconsistent state, but we surface the error so the operator can
 * retry — it's idempotent (DDB DeleteCommand is no-op on missing).
 */
export const deleteOrg = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.USERS_TABLE;
    const systemsTable = process.env.SYSTEM_PULSE_TABLE;
    if (!tableName || !systemsTable)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          message: "USERS_TABLE or SYSTEM_PULSE_TABLE not set",
        }),
      };

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "orgs-delete",
      limit: 5,
      windowSeconds: 60,
    });

    const orgId = event.pathParameters?.id;
    if (!orgId)
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "org id required" }),
      };

    const body = parse(event.body);
    const validated = (await deleteBodySchema.validate(body, {
      stripUnknown: true,
    })) as DeleteBody;

    const actorUserId = getActorUserId(event);
    if (!actorUserId)
      throw new HttpError(401, { message: "not authenticated" });

    const actor = await requireAdminActorPassword(
      docClient,
      tableName,
      actorUserId,
      validated.actorPassword,
    );
    rejectIfDemo(actor as any);

    if (!isSuperAdmin(actor.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: "forbidden - only superadmin can delete organizations",
        }),
      };
    }

    const orgResponse: any = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: "ORG", SK: `ORG#${orgId}` },
      }),
    );
    const org = orgResponse.Item;
    if (!org) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "organization not found" }),
      };
    }

    if (org.isInternal) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message:
            "forbidden - the internal platform org cannot be deleted",
        }),
      };
    }

    // Email the owner BEFORE we nuke them.
    if (org.ownerId) {
      try {
        const ownerResponse: any = await docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { PK: "USER", SK: `USER#${org.ownerId}` },
          }),
        );
        const owner = ownerResponse.Item;
        if (owner?.email) {
          await sendStatusChangeEmail({
            to: owner.email,
            recipientName: owner.full_name || "Owner",
            actorName: (actor as any).full_name,
            orgName: org.name,
            subjectKind: "organization",
            reason: validated.reason,
            notes: validated.notes,
            action: "permanently deleted",
          });
        }
      } catch (mailErr) {
        console.warn("deleteOrg email send failed:", mailErr);
      }
    }

    // 1) Delete every user in the org. Pagination loop.
    let lastUserKey: Record<string, unknown> | undefined;
    let userDeleted = 0;
    do {
      const usersResponse: any = await docClient.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "EntityTypeIndex",
          KeyConditionExpression: "entityType = :entityType",
          FilterExpression: "orgId = :orgId",
          ExpressionAttributeValues: {
            ":entityType": "USER",
            ":orgId": orgId,
          },
          ExclusiveStartKey: lastUserKey,
          Limit: 200,
        }),
      );
      const items = (usersResponse.Items || []).filter((item: any) =>
        String(item.SK || "").startsWith("USER#"),
      );
      for (const item of items) {
        await docClient.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: item.PK, SK: item.SK },
          }),
        );
        userDeleted += 1;
      }
      lastUserKey = usersResponse.LastEvaluatedKey;
    } while (lastUserKey);

    // 2) Delete every system in the org plus its log shard.
    let lastSystemKey: Record<string, unknown> | undefined;
    let systemDeleted = 0;
    do {
      const systemsResponse: any = await docClient.send(
        new QueryCommand({
          TableName: systemsTable,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          FilterExpression: "orgId = :orgId",
          ExpressionAttributeValues: {
            ":pk": "SYSTEM",
            ":sk": "SYS#",
            ":orgId": orgId,
          },
          ExclusiveStartKey: lastSystemKey,
          Limit: 100,
        }),
      );
      const sys = systemsResponse.Items || [];
      for (const item of sys) {
        // Delete the system record.
        await docClient.send(
          new DeleteCommand({
            TableName: systemsTable,
            Key: { PK: item.PK, SK: item.SK },
          }),
        );
        // Delete its logs (paginated).
        let lastLogKey: Record<string, unknown> | undefined;
        do {
          const logsResponse: any = await docClient.send(
            new QueryCommand({
              TableName: systemsTable,
              KeyConditionExpression:
                "PK = :pk AND begins_with(SK, :skPrefix)",
              ExpressionAttributeValues: {
                ":pk": `SYSTEM#${item.id}`,
                ":skPrefix": "LOG#",
              },
              ExclusiveStartKey: lastLogKey,
              Limit: 100,
            }),
          );
          for (const logItem of logsResponse.Items || []) {
            await docClient.send(
              new DeleteCommand({
                TableName: systemsTable,
                Key: { PK: logItem.PK, SK: logItem.SK },
              }),
            );
          }
          lastLogKey = logsResponse.LastEvaluatedKey;
        } while (lastLogKey);
        systemDeleted += 1;
      }
      lastSystemKey = systemsResponse.LastEvaluatedKey;
    } while (lastSystemKey);

    // 3) Delete the org record itself.
    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { PK: "ORG", SK: `ORG#${orgId}` },
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "Organization permanently deleted",
        data: {
          id: orgId,
          usersDeleted: userDeleted,
          systemsDeleted: systemDeleted,
        },
      }),
    };
  } catch (error) {
    console.error("deleteOrg error:", error);
    return handleError(error);
  }
};
