import { APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { verifyPassword } from "./password.js";
import { HttpError } from "./error-handler.js";
import { isAdminOrSuper } from "./rbac.js";

import type { UserPermissions } from "../types/user.js";

interface ActorRecord {
  id: string;
  role: string;
  status_: string;
  passwordHash?: string;
  orgId?: string;
  demoMode?: boolean;
  allowedSystemIds?: string[];
  permissions?: Partial<UserPermissions>;
}

export function getActorUserId(event: APIGatewayProxyEvent): string {
  return (
    (event.headers["x-user-id"] as string) ||
    (event.headers["X-User-Id"] as string) ||
    ""
  );
}

export function getActorRole(event: APIGatewayProxyEvent): string | undefined {
  return (
    (event.headers["x-inviter-role"] as string) ||
    (event.headers["X-Inviter-Role"] as string) ||
    undefined
  );
}

export function getActorOrgIdHeader(
  event: APIGatewayProxyEvent,
): string | undefined {
  return (
    (event.headers["x-org-id"] as string) ||
    (event.headers["X-Org-Id"] as string) ||
    undefined
  );
}

/**
 * Load the actor row from the DB. Used as the source of truth for
 * orgId, role, and demoMode. Headers are advisory; never trust them
 * for authorization decisions on their own.
 */
export async function loadActor(
  docClient: DynamoDBDocumentClient,
  usersTableName: string,
  actorUserId: string,
): Promise<ActorRecord | null> {
  if (!actorUserId) return null;

  const response = await docClient.send(
    new GetCommand({
      TableName: usersTableName,
      Key: { PK: "USER", SK: `USER#${actorUserId}` },
    }),
  );

  return (response.Item as ActorRecord | undefined) || null;
}

export async function requireActiveActor(
  docClient: DynamoDBDocumentClient,
  usersTableName: string,
  actorUserId: string,
): Promise<ActorRecord> {
  const actor = await loadActor(docClient, usersTableName, actorUserId);
  if (!actor) {
    throw new HttpError(403, { message: "forbidden - actor not found" });
  }
  if (actor.status_ !== "Active") {
    throw new HttpError(403, { message: "forbidden - actor is not active" });
  }
  return actor;
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

  const actor = await loadActor(docClient, usersTableName, actorUserId);

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

/**
 * Throw a 403 if the actor is in demo mode. Used to harden destructive
 * endpoints where demo testers should never be allowed to mutate the
 * platform owner's data.
 */
export function rejectIfDemo(actor: ActorRecord): void {
  if (actor.demoMode) {
    throw new HttpError(403, {
      message:
        "Demo mode is read-mostly. Sign up for a free account to delete or destructively modify data.",
    });
  }
}
