import {
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { User, CreateUserInput } from "../types/user.js";

const USER_PK = "USER";
const SK_PREFIX_USER = "USER#";

interface UserRecord extends User {
  PK: string;
  SK: string;
  inviteToken?: string;
  tokenExpiry?: number;
  entityType?: string;
  expiresAt?: number;
}

export const createUserService = (
  docClient: DynamoDBDocumentClient,
  tableName: string,
) => {
  return {
    /**
     * Used by org admins to invite a new org member.
     * `orgId` MUST be provided by the caller; it is the inviter's org.
     */
    async createUserInvitation(
      input: CreateUserInput & { orgId?: string },
    ): Promise<{
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

    /**
     * Used by self-serve registration. Creates an active admin user
     * directly (no invite token). Caller is responsible for setting
     * orgId and passwordHash.
     */
    async createActiveAdmin(input: {
      email: string;
      full_name: string;
      passwordHash: string;
      orgId: string;
      explicitId?: string;
    }): Promise<User> {
      const userId = input.explicitId || uuidv4();
      const createDate = new Date().toISOString();

      const user: User = {
        id: userId,
        email: input.email,
        full_name: input.full_name,
        role: "admin",
        status_: "Active",
        createDate,
        passwordHash: input.passwordHash,
        allowedSystemIds: [],
        orgId: input.orgId,
      };

      const record: UserRecord = {
        ...user,
        PK: USER_PK,
        SK: `${SK_PREFIX_USER}${userId}`,
        entityType: USER_PK,
      };

      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: record,
        }),
      );

      return user;
    },

    /**
     * Creates an ephemeral demo user attached to the given org. Demo
     * users are flagged with `demoMode: true`, get a TTL via DDB
     * `expiresAt`, and are gated out of destructive endpoints.
     */
    async createDemoUser(input: {
      orgId: string;
      role: "admin" | "user";
      displayName: string;
      ttlSeconds: number;
    }): Promise<User> {
      const userId = `demo-${uuidv4()}`;
      const createDate = new Date().toISOString();
      const nowSeconds = Math.floor(Date.now() / 1000);
      const expiresAt = nowSeconds + input.ttlSeconds;

      const user: User = {
        id: userId,
        email: `${userId}@demo.local`,
        full_name: input.displayName,
        role: input.role,
        status_: "Active",
        createDate,
        allowedSystemIds: [],
        orgId: input.orgId,
        demoMode: true,
        demoExpiresAt: expiresAt,
      };

      const record: UserRecord = {
        ...user,
        PK: USER_PK,
        SK: `${SK_PREFIX_USER}${userId}`,
        entityType: USER_PK,
        expiresAt,
      };

      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: record,
        }),
      );

      return user;
    },
  };
};
