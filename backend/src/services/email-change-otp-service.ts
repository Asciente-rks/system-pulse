import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { hashOtp } from "./otp-service.js";

/**
 * Pending email-change request. Distinct from the registration OTP
 * record so the two flows don't collide if the same email/user is
 * doing both at once.
 */
const PK = "EMAIL_CHANGE_OTP";
const SK_PREFIX = "USER#";

export interface PendingEmailChange {
  userId: string;
  newEmail: string;
  otpHash: string;
  expiresAt: number; // epoch seconds, drives DDB TTL
  attempts: number;
  createDate: string;
}

interface PendingRecord extends PendingEmailChange {
  PK: string;
  SK: string;
  entityType: string;
}

const key = (userId: string) => ({ PK, SK: `${SK_PREFIX}${userId}` });

export const createEmailChangeOtpService = (
  docClient: DynamoDBDocumentClient,
  tableName: string,
) => ({
  async put(input: PendingEmailChange): Promise<void> {
    const record: PendingRecord = {
      ...input,
      PK,
      SK: `${SK_PREFIX}${input.userId}`,
      entityType: "EMAIL_CHANGE_OTP",
    };
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: record,
      }),
    );
  },

  async get(userId: string): Promise<PendingEmailChange | null> {
    const response = await docClient.send(
      new GetCommand({ TableName: tableName, Key: key(userId) }),
    );
    return (response.Item as PendingEmailChange | undefined) || null;
  },

  async delete(userId: string): Promise<void> {
    await docClient.send(
      new DeleteCommand({ TableName: tableName, Key: key(userId) }),
    );
  },

  hashOtp,
});
