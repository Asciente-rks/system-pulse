import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import {
  canInviteRole,
  canSeeOrg,
  isAdminOrSuper,
} from "../../utils/rbac.js";
import { DEMO_ORG_ID } from "../../types/organization.js";

const effectiveOrgId = (orgId?: unknown): string =>
  typeof orgId === "string" && orgId.length > 0 ? orgId : DEMO_ORG_ID;

export const getUser = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.USERS_TABLE;

    if (!tableName) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: "USERS_TABLE not set" }),
      };
    }

    const inviterRole =
      (event.headers &&
        ((event.headers["x-inviter-role"] as string) ||
          (event.headers["X-Inviter-Role"] as string))) ||
      undefined;

    const actorUserId =
      (event.headers &&
        ((event.headers["x-user-id"] as string) ||
          (event.headers["X-User-Id"] as string))) ||
      undefined;

    if (!isAdminOrSuper(inviterRole as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: "forbidden" }),
      };
    }

    const userId = event.pathParameters?.id;
    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "user id required" }),
      };
    }

    let actorOrgId: string | undefined;
    let actorRole = inviterRole;
    if (actorUserId) {
      try {
        const actorResponse: any = await docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { PK: "USER", SK: `USER#${actorUserId}` },
          }),
        );
        const u = actorResponse.Item || {};
        actorOrgId = u.orgId as string | undefined;
        actorRole = (u.role as string | undefined) || actorRole;
      } catch {}
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: "USER", SK: `USER#${userId}` },
      }),
    );

    const user = result.Item;

    if (!user) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: "user not found" }),
      };
    }

    if (!canInviteRole(actorRole as any, user.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: "forbidden - out of role scope" }),
      };
    }

    if (!canSeeOrg(
      actorRole as any,
      actorOrgId,
      effectiveOrgId(user.orgId),
    )) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ message: "forbidden - out of org scope" }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        data: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          status_: user.status_,
          createDate: user.createDate,
          allowedSystemIds: Array.isArray(user.allowedSystemIds)
            ? user.allowedSystemIds
            : [],
          orgId: effectiveOrgId(user.orgId),
        },
      }),
    };
  } catch (error) {
    console.error("get-user error:", error);
    return handleError(error);
  }
};
