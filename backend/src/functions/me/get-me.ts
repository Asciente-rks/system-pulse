import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import {
  getActorUserId,
  loadActor,
} from "../../utils/actor-auth.js";
import { resolvePermissions } from "../../types/user.js";
import { HttpError } from "../../utils/error-handler.js";

/**
 * `GET /me` — return the current session-bound user. Identical
 * shape to the login response so the SPA can refresh its cached
 * `useAuth` payload after profile edits without re-authenticating.
 */
export const getMe = async (
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

    const actorUserId = getActorUserId(event);
    if (!actorUserId)
      throw new HttpError(401, { message: "not authenticated" });

    const actor = await loadActor(docClient, tableName, actorUserId);
    if (!actor) throw new HttpError(403, { message: "actor not found" });

    let orgName: string | undefined;
    if ((actor as any).orgId) {
      try {
        const orgResponse = await docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { PK: "ORG", SK: `ORG#${(actor as any).orgId}` },
          }),
        );
        orgName = (orgResponse.Item as { name?: string } | undefined)?.name;
      } catch {
        /* best-effort */
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        data: {
          id: actor.id,
          email: (actor as any).email,
          full_name: (actor as any).full_name,
          role: actor.role,
          status_: actor.status_,
          allowedSystemIds: Array.isArray(actor.allowedSystemIds)
            ? actor.allowedSystemIds
            : [],
          orgId: (actor as any).orgId,
          orgName,
          demoMode: Boolean((actor as any).demoMode),
          permissions: resolvePermissions(actor as any),
        },
      }),
    };
  } catch (error) {
    console.error("get-me error:", error);
    return handleError(error);
  }
};
