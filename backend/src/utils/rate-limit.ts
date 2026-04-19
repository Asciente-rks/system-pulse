import { APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { HttpError } from "./error-handler.js";

interface EnforceRateLimitInput {
  docClient: DynamoDBDocumentClient;
  tableName: string;
  event: APIGatewayProxyEvent;
  key: string;
  limit: number;
  windowSeconds: number;
}

function getSourceIp(event: APIGatewayProxyEvent): string {
  const forwarded =
    event.headers["x-forwarded-for"] || event.headers["X-Forwarded-For"];

  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }

  return event.requestContext?.identity?.sourceIp || "unknown-ip";
}

function getActorId(event: APIGatewayProxyEvent): string {
  return (
    event.headers["x-user-id"] || event.headers["X-User-Id"] || "anonymous"
  );
}

export async function enforceRateLimit({
  docClient,
  tableName,
  event,
  key,
  limit,
  windowSeconds,
}: EnforceRateLimitInput): Promise<void> {
  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowEpochSeconds / windowSeconds);
  const sourceIp = getSourceIp(event);
  const actorId = getActorId(event);
  const rateKey = `${key}#${sourceIp}#${actorId}#${bucket}`;

  const response = await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: "RATE_LIMIT",
        SK: rateKey,
      },
      UpdateExpression:
        "ADD requestCount :increment SET expiresAt = if_not_exists(expiresAt, :ttl), entityType = :entityType, updatedAt = :now",
      ExpressionAttributeValues: {
        ":increment": 1,
        ":ttl": nowEpochSeconds + windowSeconds + 300,
        ":entityType": "RATE_LIMIT",
        ":now": new Date().toISOString(),
      },
      ReturnValues: "UPDATED_NEW",
    }),
  );

  const currentCount = Number((response.Attributes || {}).requestCount || 0);

  if (currentCount > limit) {
    throw new HttpError(429, {
      status: 429,
      message: "Too many requests. Please wait and try again.",
    });
  }
}
