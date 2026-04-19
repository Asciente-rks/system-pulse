import { APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { verifyPassword } from "./password.js";
import { HttpError } from "./error-handler.js";
import { isAdminOrSuper } from "./rbac.js";

interface ActorRecord {
  id: string;
  role: string;
  status_: string;
  passwordHash?: string;
}

export function getActorUserId(event: APIGatewayProxyEvent): string {
  return (
    (event.headers["x-user-id"] as string) ||
    (event.headers["X-User-Id"] as string) ||
    ""
  );
}

export async function requireAdminActorPassword(
  docClient: DynamoDBDocumentClient,
  usersTableName: string,
  actorUserId: string,
  actorPassword: string,
): Promise<ActorRecord> {
  if (!actorUserId) {
    throw new HttpError(403, { message: "forbidden - actor user id required" });
  }

  if (!actorPassword) {
    throw new HttpError(400, { message: "actorPassword is required" });
  }

  const actorResponse = await docClient.send(
    new GetCommand({
      TableName: usersTableName,
      Key: { PK: "USER", SK: `USER#${actorUserId}` },
    }),
  );

  const actor = actorResponse.Item as ActorRecord | undefined;

  if (!actor) {
    throw new HttpError(403, { message: "forbidden - actor not found" });
  }

  if (!isAdminOrSuper(actor.role as any)) {
    throw new HttpError(403, { message: "forbidden - admin role required" });
  }

  if (actor.status_ !== "Active") {
    throw new HttpError(403, { message: "forbidden - actor is not active" });
  }

  if (!verifyPassword(actorPassword, actor.passwordHash)) {
    throw new HttpError(401, { message: "invalid actor password" });
  }

  return actor;
}
