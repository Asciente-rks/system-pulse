import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
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

const DEMO_TTL_SECONDS_DEFAULT = 60 * 60; // 1 hour

interface DemoStartBody {
  role: "admin" | "user";
  display_name?: string;
}

/**
 * Spin up an ephemeral demo session. The session is a real (but
 * throwaway) user attached to the platform-owned demo org. It carries
 * `demoMode: true`, gets auto-deleted via DDB TTL, and is rejected from
 * destructive endpoints (delete-user, delete-system).
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

    const user = await userService.createDemoUser({
      orgId: demoOrg.id,
      role,
      displayName,
      ttlSeconds,
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
