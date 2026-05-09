import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash, randomInt } from "crypto";

/**
 * Pending registration record stored for a brief OTP window.
 * The OTP itself is hashed before storage (sha256). The plain
 * password is hashed via scrypt before storage (matches the rest of
 * the auth surface).
 */
const OTP_PK = "REGISTER_OTP";
const OTP_SK_PREFIX = "OTP#";

export interface PendingRegistration {
  email: string;
  passwordHash: string;
  full_name: string;
  org_name: string;
  otpHash: string;
  expiresAt: number; // epoch seconds, drives DDB TTL
  attempts: number;
  resendCount: number;
  lastSentAt: number; // epoch seconds
  createDate: string;
}

interface OtpRecord extends PendingRegistration {
  PK: string;
  SK: string;
  entityType: string;
}

export const hashOtp = (otp: string): string =>
  createHash("sha256").update(otp).digest("hex");

export const generateNumericOtp = (digits = 6): string => {
  const min = 10 ** (digits - 1);
  const max = 10 ** digits;
  // randomInt(max) is [0, max) so we add `min` then mod into bounds.
  const value = randomInt(0, max - min) + min;
  return String(value).padStart(digits, "0");
};

const otpKey = (email: string): { PK: string; SK: string } => ({
  PK: OTP_PK,
  SK: `${OTP_SK_PREFIX}${email.toLowerCase()}`,
});

export const createOtpService = (
  docClient: DynamoDBDocumentClient,
  tableName: string,
) => ({
  async putPending(input: PendingRegistration): Promise<void> {
    const record: OtpRecord = {
      ...input,
      PK: OTP_PK,
      SK: `${OTP_SK_PREFIX}${input.email.toLowerCase()}`,
      entityType: "REGISTER_OTP",
    };

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: record,
      }),
    );
  },

  async getPending(email: string): Promise<PendingRegistration | null> {
    const response = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: otpKey(email),
      }),
    );
    return (response.Item as PendingRegistration | undefined) || null;
  },

  async deletePending(email: string): Promise<void> {
    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: otpKey(email),
      }),
    );
  },
});
