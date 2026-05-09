import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import {
  getActorUserId,
  loadActor,
  rejectIfDemo,
} from "../../utils/actor-auth.js";
import { isSuperAdmin } from "../../utils/rbac.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { HttpError } from "../../utils/error-handler.js";

/**
 * `GET /orgs` — superadmin-only listing of every organization on the
 * platform with high-level metadata (name, owner, member count,
 * system count). Plain admins / users get 403; the response is
 * intentionally limited to surface-level data so superadmins can
 * "see the shape" of the platform without snooping member details.
 */
export const listOrgs = async (
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
      key: "orgs-list",
      limit: 30,
      windowSeconds: 60,
    });

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
          message: "forbidden - superadmin only",
        }),
      };
    }

    // Pull every ORG record. Records that don't carry an `entityType`
    // (legacy) are skipped — we expect every ORG to have one set.
    const orgsResponse = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "EntityTypeIndex",
        KeyConditionExpression: "entityType = :entityType",
        ExpressionAttributeValues: { ":entityType": "ORG" },
        Limit: 200,
      }),
    );

    const orgs = (orgsResponse.Items || []).filter((item) =>
      String(item.SK || "").startsWith("ORG#"),
    );

    // For each org, compute member + system counts. Two queries each
    // is fine at portfolio scale; if this grows, denormalise the
    // counts onto the org record on user/system create.
    const enriched = await Promise.all(
      orgs.map(async (org) => {
        let memberCount = 0;
        let systemCount = 0;
        let ownerEmail: string | undefined;
        let ownerName: string | undefined;

        try {
          const usersForOrg = await docClient.send(
            new QueryCommand({
              TableName: tableName,
              IndexName: "EntityTypeIndex",
              KeyConditionExpression: "entityType = :entityType",
              FilterExpression: "orgId = :orgId",
              ExpressionAttributeValues: {
                ":entityType": "USER",
                ":orgId": org.id,
              },
              Limit: 200,
            }),
          );
          const visibleUsers = (usersForOrg.Items || []).filter(
            (u) =>
              String(u.SK || "").startsWith("USER#") && !u.demoMode,
          );
          memberCount = visibleUsers.length;

          // Owner enrichment for the table.
          const ownerRow = visibleUsers.find(
            (u) => u.id === org.ownerId,
          );
          if (ownerRow) {
            ownerEmail = String(ownerRow.email || "");
            ownerName = String(ownerRow.full_name || "");
          }
        } catch (countErr) {
          console.warn("list-orgs: member count failed", countErr);
        }

        try {
          const systemsForOrg = await docClient.send(
            new QueryCommand({
              TableName: process.env.SYSTEM_PULSE_TABLE!,
              KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
              FilterExpression: "orgId = :orgId",
              ExpressionAttributeValues: {
                ":pk": "SYSTEM",
                ":sk": "SYS#",
                ":orgId": org.id,
              },
              Limit: 200,
            }),
          );
          systemCount = (systemsForOrg.Items || []).length;
        } catch (countErr) {
          console.warn("list-orgs: system count failed", countErr);
        }

        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          ownerId: org.ownerId,
          ownerEmail,
          ownerName,
          isDemo: Boolean(org.isDemo),
          createDate: org.createDate,
          memberCount,
          systemCount,
        };
      }),
    );

    // Sort by createDate desc so newest orgs surface first.
    enriched.sort((a, b) =>
      String(b.createDate || "").localeCompare(String(a.createDate || "")),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        data: { orgs: enriched, count: enriched.length },
      }),
    };
  } catch (error) {
    console.error("list-orgs error:", error);
    return handleError(error);
  }
};
