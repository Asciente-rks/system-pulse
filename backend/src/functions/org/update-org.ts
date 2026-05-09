import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as yup from "yup";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { orgNameYup } from "../../validation/user-validation.js";
import {
  getActorUserId,
  loadActor,
  rejectIfDemo,
} from "../../utils/actor-auth.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { HttpError } from "../../utils/error-handler.js";
import { isOwner, isSuperAdmin } from "../../utils/rbac.js";

const updateOrgSchema = yup.object({
  name: orgNameYup,
});

interface Body {
  name: string;
}

/**
 * `PATCH /orgs/:id` — rename an organization. Only the org's owner
 * (or superadmin) can do this. Other org members get 403 even if
 * their canUpdateUser permission is on.
 */
export const updateOrg = async (
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
      key: "orgs-update",
      limit: 10,
      windowSeconds: 60,
    });

    const orgId = event.pathParameters?.id;
    if (!orgId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "org id required" }),
      };
    }

    const body = parse(event.body);
    const validated = (await updateOrgSchema.validate(body, {
      stripUnknown: true,
    })) as Body;

    const actorUserId = getActorUserId(event);
    if (!actorUserId)
      throw new HttpError(401, { message: "not authenticated" });

    const actor = await loadActor(docClient, tableName, actorUserId);
    if (!actor) throw new HttpError(403, { message: "actor not found" });
    rejectIfDemo(actor as any);

    if (!isOwner(actor.role as any) && !isSuperAdmin(actor.role as any)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: "forbidden - only the org owner can rename the org",
        }),
      };
    }

    if (!isSuperAdmin(actor.role as any) && actor.orgId !== orgId) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          message: "forbidden - cannot edit another organization",
        }),
      };
    }

    // Confirm the org exists before writing.
    const orgResponse: any = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: "ORG", SK: `ORG#${orgId}` },
      }),
    );
    if (!orgResponse.Item) {
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
        UpdateExpression: "SET #name = :name",
        ExpressionAttributeNames: { "#name": "name" },
        ExpressionAttributeValues: { ":name": validated.name },
      }),
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 200,
        message: "Organization updated",
        data: { id: orgId, name: validated.name },
      }),
    };
  } catch (error) {
    console.error("update-org error:", error);
    return handleError(error);
  }
};
