import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { User, CreateUserInput } from "../types/user.js";

const USER_PK = "USER";
const SK_PREFIX_USER = "USER#";
const SK_PREFIX_INVITE = "INVITE#";

interface UserRecord extends User {
  PK: string;
  SK: string;
  inviteToken?: string;
  tokenExpiry?: number;
  entityType?: string;
}

export const createUserService = (
  docClient: DynamoDBDocumentClient,
  tableName: string,
) => {
  return {
    async createUserInvitation(input: CreateUserInput): Promise<{
      user: User;
      inviteToken: string;
      inviteEligibilityExpiresAt: string;
    }> {
      const userId = uuidv4();
      const inviteToken = uuidv4();
      const createDate = new Date().toISOString();
      const inviteEligibilityHours = Math.max(
        1,
        Number(process.env.INVITE_ELIGIBILITY_HOURS || 24),
      );
      const inviteExpiryMs =
        Date.now() + inviteEligibilityHours * 60 * 60 * 1000;

      const user: User = {
        id: userId,
        ...input,
        status_: "Pending",
        createDate,
      };

      const record: UserRecord = {
        ...user,
        PK: USER_PK,
        entityType: USER_PK,
        SK: `${SK_PREFIX_USER}${userId}`,
        inviteToken,
        tokenExpiry: inviteExpiryMs,
      };

      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: record,
        }),
      );

      return {
        user,
        inviteToken,
        inviteEligibilityExpiresAt: new Date(inviteExpiryMs).toISOString(),
      };
    },
  };
};
