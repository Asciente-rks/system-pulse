import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as yup from "yup";
import { docClient } from "../../config/db.js";
import { handleError, headers, HttpError } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { isSuperAdmin } from "../../utils/rbac.js";
import {
  getActorUserId,
  loadActor,
  rejectIfDemo,
} from "../../utils/actor-auth.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { sendStatusChangeEmail } from "../../services/email-service.js";
import { resolveFrontendBaseUrl } from "../../utils/frontend-url.js";

const ORG_SUSPEND_REASONS = [
  "Policy violation",
  "Service abuse",
  "Payment overdue",
  "Security concern",
  "Inactive — preserve data",
  "Other",
] as const;

const suspendBodySchema = yup.object({
  reason: yup
    .mixed<(typeof ORG_SUSPEND_REASONS)[number]>()
    .oneOf([...ORG_SUSPEND_REASONS])
    .required("A reason is required"),
  notes: yup
    .string()
    .max(2000, "Notes too long")
    .optional(),
});

const reactivateBodySchema = yup.object({
  notes: yup
    .string()
    .max(2000, "Notes too long")
    .optional(),
});

interface SuspendBody {
  reason: (typeof ORG_SUSPEND_REASONS)[number];
  notes?: string;
}

interface ReactivateBody {
  notes?: string;
}

/**
 * POST /orgs/:id/suspend
 * Superadmin-only. Sets the org's `status_` to "Suspended", stores
 * the moderator-selected reason + free-text notes, and emails the
 * org owner. Members of a suspended org are blocked at login.
 */
export const suspendOrg = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.USERS_TABLE;
    if (!tableName)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "USERS_TABLE not set" }),
      };

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "orgs-suspend",
      limit: 20,
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
    const validated = (await suspendBodySchema.validate(body, {
      stripUnknown: true,
    })) as SuspendBody;

    const actorUserId = getActorUserId(event);
    if (!actorUserId)
      throw new HttpError(401, { message: "not authenticated" });

    const actor = await loadActor(docClient, tableName, actorUserId);
    if (!actor) throw new HttpError(403, { message: "actor not found" });
    rejectIfDemo(actor as any);

    if (!isSuperAdmin(actor.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: "forbidden - only superadmin can suspend organizations",
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
          message: "forbidden - internal orgs cannot be suspended",
        }),
      };
    }

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: "ORG", SK: `ORG#${orgId}` },
        UpdateExpression:
          "SET #status = :status, suspendedReason = :reason, suspendedNotes = :notes, suspendedAt = :ts, suspendedBy = :actor",
        ExpressionAttributeNames: { "#status": "status_" },
        ExpressionAttributeValues: {
          ":status": "Suspended",
          ":reason": validated.reason,
          ":notes": validated.notes || "",
          ":ts": new Date().toISOString(),
          ":actor": actorUserId,
        },
      }),
    );

    // Email the owner (best-effort).
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
            action: "suspended",
          });
        }
      } catch (mailErr) {
        console.warn("suspendOrg email send failed:", mailErr);
      }
    }

    void resolveFrontendBaseUrl;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "Organization suspended",
        data: { id: orgId },
      }),
    };
  } catch (error) {
    console.error("suspendOrg error:", error);
    return handleError(error);
  }
};

/**
 * POST /orgs/:id/unsuspend — reverse of suspend.
 */
export const reactivateOrg = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.USERS_TABLE;
    if (!tableName)
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "USERS_TABLE not set" }),
      };

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "orgs-unsuspend",
      limit: 20,
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
    const validated = (await reactivateBodySchema.validate(body, {
      stripUnknown: true,
    })) as ReactivateBody;

    const actorUserId = getActorUserId(event);
    if (!actorUserId)
      throw new HttpError(401, { message: "not authenticated" });

    const actor = await loadActor(docClient, tableName, actorUserId);
    if (!actor) throw new HttpError(403, { message: "actor not found" });
    rejectIfDemo(actor as any);

    if (!isSuperAdmin(actor.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: "forbidden - only superadmin can reactivate organizations",
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

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: "ORG", SK: `ORG#${orgId}` },
        UpdateExpression:
          "SET #status = :status REMOVE suspendedReason, suspendedNotes, suspendedAt, suspendedBy",
        ExpressionAttributeNames: { "#status": "status_" },
        ExpressionAttributeValues: { ":status": "Active" },
      }),
    );

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
            reason: "Reactivated by superadmin",
            notes: validated.notes,
            action: "reactivated",
            loginLink: `${process.env.FRONTEND_URL || ""}/login`,
          });
        }
      } catch (mailErr) {
        console.warn("reactivateOrg email send failed:", mailErr);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "Organization reactivated",
        data: { id: orgId },
      }),
    };
  } catch (error) {
    console.error("reactivateOrg error:", error);
    return handleError(error);
  }
};
