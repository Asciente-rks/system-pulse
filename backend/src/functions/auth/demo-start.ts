import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../config/db.js";
import { handleError, headers } from "../../utils/error-handler.js";
import { parse } from "../../utils/parse.js";
import { demoStartSchema } from "../../validation/user-validation.js";
import { enforceRateLimit } from "../../utils/rate-limit.js";
import { createUserService } from "../../services/user-service.js";
import {
  createOrganizationService,
} from "../../services/organization-service.js";
import { DEMO_ORG_ID } from "../../types/organization.js";
import {
  DEFAULT_PERMISSIONS_BY_ROLE,
  resolvePermissions,
  type UserPermissions,
} from "../../types/user.js";

const DEMO_TTL_SECONDS_DEFAULT = 60 * 60; // 1 hour

interface DemoStartBody {
  role: "admin" | "user";
  display_name?: string;
}

const templateUserId = (role: "admin" | "user"): string =>
  `demo-template-${role}`;

/**
 * Look up (or auto-create) the "demo template" user for the given
 * persona. Templates are stored as ordinary USER records in the
 * demo org, but with `isDemoTemplate: true` and no passwordHash,
 * so they cannot log in directly. Their `permissions` field is the
 * single source of truth for what fresh demo sessions are allowed
 * to do — superadmins edit those permissions like any other user
 * via the Platform tab → Demo org → Members → Settings flow.
 *
 * Auto-provisioning means a fresh deploy doesn't need any extra
 * setup; the first /auth/demo call seeds the templates with the
 * role's default permissions.
 */
async function ensureDemoTemplate(
  tableName: string,
  role: "admin" | "user",
): Promise<UserPermissions> {
  const id = templateUserId(role);
  const existing: any = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: "USER", SK: `USER#${id}` },
    }),
  );

  if (existing.Item) {
    return resolvePermissions(existing.Item as any);
  }

  const defaults = { ...DEFAULT_PERMISSIONS_BY_ROLE[role] };
  const now = new Date().toISOString();
  const record = {
    PK: "USER",
    SK: `USER#${id}`,
    entityType: "USER",
    id,
    email: `${id}@demo.local`,
    full_name:
      role === "admin"
        ? "Demo Admin Template"
        : "Demo User Template",
    role,
    status_: "Active",
    createDate: now,
    allowedSystemIds: [],
    orgId: DEMO_ORG_ID,
    permissions: defaults,
    isDemoTemplate: true,
  };

  await docClient.send(
    new PutCommand({ TableName: tableName, Item: record }),
  );

  return defaults;
}

/**
 * Spin up an ephemeral demo session. The session is a real (but
 * throwaway) user attached to the platform-owned demo org. It carries
 * `demoMode: true`, gets auto-deleted via DDB TTL, and is rejected from
 * destructive endpoints (delete-user, delete-system).
 *
 * Permissions for the session are sourced from the matching demo
 * template (auto-provisioned on first call) so changes the
 * superadmin makes via the dashboard take effect on the very next
 * demo session — no redeploy required.
 */
export const demoStart = async (
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

    await enforceRateLimit({
      docClient,
      tableName,
      event,
      key: "auth-demo-start",
      limit: 8,
      windowSeconds: 60,
    });

    const body = parse(event.body) as Record<string, unknown>;
    const validated = (await demoStartSchema.validate(body, {
      stripUnknown: true,
    })) as DemoStartBody;

    const orgService = createOrganizationService(docClient, tableName);
    const userService = createUserService(docClient, tableName);

    // The demo org is provisioned by the seed script. If it does not
    // exist (fresh deploy), provision it on the fly so the experience
    // never breaks.
    let demoOrg = await orgService.getOrganization(DEMO_ORG_ID);
    if (!demoOrg) {
      demoOrg = await orgService.createOrganization({
        explicitId: DEMO_ORG_ID,
        name: "System Pulse Demo",
        ownerId: "platform",
        isDemo: true,
      });
    }

    const ttlSeconds = Math.max(
      5 * 60,
      Number(process.env.DEMO_SESSION_TTL_SECONDS || DEMO_TTL_SECONDS_DEFAULT),
    );

    const role: "admin" | "user" = validated.role || "admin";
    const displayName = validated.display_name?.trim() || "Demo Tester";

    // Pull the live permissions snapshot from the template.
    const templatePermissions = await ensureDemoTemplate(tableName, role);

    const user = await userService.createDemoUser({
      orgId: demoOrg.id,
      role,
      displayName,
      ttlSeconds,
      permissions: templatePermissions,
    });

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        status: 201,
        message: "Demo session ready. Explore real systems with safety guards.",
        data: {
          user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: user.role,
            status_: user.status_,
            allowedSystemIds: user.allowedSystemIds || [],
            orgId: demoOrg.id,
            orgName: demoOrg.name,
            demoMode: true,
            demoExpiresAt: user.demoExpiresAt,
            permissions: resolvePermissions(user as any),
          },
          ttlSeconds,
        },
      }),
    };
  } catch (error) {
    console.error("demo-start error:", error);
    return handleError(error);
  }
};
