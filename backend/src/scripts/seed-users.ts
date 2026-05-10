import "dotenv/config";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient } from "../config/db.js";
import { scryptSync, randomBytes } from "crypto";
import { DEMO_ORG_ID } from "../types/organization.js";
import { DEFAULT_PERMISSIONS_BY_ROLE } from "../types/user.js";

/**
 * Sentinel id for the org that holds the platform-level superadmin's
 * personal systems. Hidden from regular org listings (orgs.tsx
 * filters by isInternal) — the superadmin uses it as their own
 * private workspace.
 */
const PLATFORM_ORG_ID = "platform";

/**
 * Bootstrap seed for a fresh deployment.
 *
 * What gets created:
 *   1. The shared "demo" organization that hosts the platform owner's
 *      personal projects + every demo session that gets spawned via
 *      `POST /auth/demo`.
 *   2. **Optionally** a hidden superadmin account read entirely from
 *      env vars — never hard-coded in source.
 *      `SEED_SUPERADMIN_EMAIL` + `SEED_SUPERADMIN_PASSWORD` must
 *      both be set, otherwise the superadmin is skipped.
 *   3. **Optionally** demo admin / user accounts, also env-gated.
 *      Useful for local development without going through the full
 *      register flow. Default behaviour: don't seed them.
 *   4. Backfills `orgId = DEMO_ORG_ID` onto any pre-existing legacy
 *      systems so they show up correctly in the demo org.
 *
 * Nothing in this file embeds a password or an email any reviewer
 * could pull from the repo. The platform owner's superadmin
 * credentials live in CI/Lambda env, never in git.
 */
async function seed() {
  const tableName =
    process.argv[2] ||
    process.env.USERS_TABLE ||
    process.env.TABLE_NAME ||
    process.env.SYSTEM_PULSE_TABLE;
  if (!tableName) {
    console.error(
      "Provide table name as arg or set USERS_TABLE/TABLE_NAME/SYSTEM_PULSE_TABLE",
    );
    process.exit(1);
  }

  const region = process.env.AWS_REGION || "ap-southeast-1";
  const ddbClient = new DynamoDBClient({ region });

  try {
    await ddbClient.send(new DescribeTableCommand({ TableName: tableName }));
  } catch (err) {
    console.error(
      `DynamoDB table '${tableName}' was not found in region '${region}'.`,
    );
    console.error(
      "Run the deployment workflow to provision infra, then rerun seeding.",
    );
    process.exit(1);
  }

  const now = new Date().toISOString();
  let failureCount = 0;

  // 1) Demo organization.
  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: "ORG",
          SK: `ORG#${DEMO_ORG_ID}`,
          entityType: "ORG",
          // status_ is required so the EntityTypeIndex GSI picks
          // this row up when superadmin queries cross-org.
          status_: "Active",
          id: DEMO_ORG_ID,
          name: "System Pulse Demo",
          slug: "demo",
          isDemo: true,
          ownerId: "platform",
          createDate: now,
        },
      }),
    );
    console.log("Seeded demo organization");
  } catch (err) {
    console.error("Failed to seed demo organization:", err);
    failureCount += 1;
  }

  // 1b) Platform organization — the private workspace for the
  // superadmin's personal systems. Always provisioned so the
  // Systems tab works for any superadmin signed into the platform.
  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: "ORG",
          SK: `ORG#${PLATFORM_ORG_ID}`,
          entityType: "ORG",
          status_: "Active",
          id: PLATFORM_ORG_ID,
          name: "Platform (Superadmin)",
          slug: "platform",
          isDemo: false,
          ownerId: "seed-superadmin",
          createDate: now,
          isInternal: true,
        },
      }),
    );
    console.log("Seeded platform organization");
  } catch (err) {
    console.error("Failed to seed platform organization:", err);
    failureCount += 1;
  }

  // 2) Env-gated user seeding. Each block runs only if its
  //    matching credentials are present in env.
  const seedAccount = async (input: {
    id: string;
    email: string | undefined;
    password: string | undefined;
    full_name: string;
    role: "superadmin" | "admin" | "user";
    orgId?: string;
  }) => {
    if (!input.email || !input.password) {
      console.log(
        `Skipped ${input.id} (no SEED_${input.id.toUpperCase()}_EMAIL/PASSWORD in env)`,
      );
      return;
    }

    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync(input.password, salt, 64).toString("hex");
    const passwordHash = `${salt}:${derived}`;

    const item = {
      PK: "USER",
      SK: `USER#${input.id}`,
      entityType: "USER",
      id: input.id,
      email: input.email,
      full_name: input.full_name,
      role: input.role,
      status_: "Active",
      passwordHash,
      createDate: now,
      allowedSystemIds: [],
      ...(input.orgId ? { orgId: input.orgId } : {}),
      permissions: { ...DEFAULT_PERMISSIONS_BY_ROLE[input.role] },
    } as Record<string, unknown>;

    try {
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: item,
        }),
      );
      console.log(`Seeded ${input.id} (${input.role})`);
    } catch (err) {
      console.error(`Failed to seed ${input.id}:`, err);
      failureCount += 1;
    }
  };

  // Default superadmin email is the platform owner's personal
  // address. The password ALWAYS has to come from env — knowing the
  // email gets you nothing without it. This means a fresh deploy
  // doesn't accidentally seed a passwordless superadmin row.
  await seedAccount({
    id: "seed-superadmin",
    email:
      process.env.SEED_SUPERADMIN_EMAIL || "sonioralphkenneth@gmail.com",
    password: process.env.SEED_SUPERADMIN_PASSWORD,
    full_name: process.env.SEED_SUPERADMIN_NAME || "Platform Admin",
    role: "superadmin",
    // Superadmin lives in the platform org so the Systems tab gets
    // a non-empty default scope.
    orgId: PLATFORM_ORG_ID,
  });

  // Idempotent backfill: if a superadmin row already exists from an
  // earlier seed (no orgId), tag it onto the platform org so they
  // see *their* systems instead of a cross-org dump.
  try {
    const existing: any = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: "USER", SK: `USER#seed-superadmin` },
      }),
    );
    if (existing.Item && !existing.Item.orgId) {
      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: "USER", SK: `USER#seed-superadmin` },
          UpdateExpression: "SET orgId = :orgId",
          ExpressionAttributeValues: { ":orgId": PLATFORM_ORG_ID },
        }),
      );
      console.log(
        "Backfilled orgId=platform on existing seed-superadmin row",
      );
    }
  } catch (err) {
    console.warn("Superadmin orgId backfill skipped:", err);
  }

  await seedAccount({
    id: "seed-admin",
    email: process.env.SEED_DEMO_ADMIN_EMAIL,
    password: process.env.SEED_DEMO_ADMIN_PASSWORD,
    full_name: process.env.SEED_DEMO_ADMIN_NAME || "Demo Admin",
    role: "admin",
    orgId: DEMO_ORG_ID,
  });

  await seedAccount({
    id: "seed-user",
    email: process.env.SEED_DEMO_USER_EMAIL,
    password: process.env.SEED_DEMO_USER_PASSWORD,
    full_name: process.env.SEED_DEMO_USER_NAME || "Demo User",
    role: "user",
    orgId: DEMO_ORG_ID,
  });

  // 3) Backfill orgId on any pre-existing systems.
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  let backfilledSystems = 0;

  do {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": "SYSTEM",
          ":skPrefix": "SYS#",
        },
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 200,
      }),
    );

    for (const item of response.Items || []) {
      if ((item as { orgId?: string }).orgId) continue;

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: "SET orgId = :orgId",
            ExpressionAttributeValues: { ":orgId": DEMO_ORG_ID },
          }),
        );
        backfilledSystems += 1;
      } catch (err) {
        console.error(
          `Failed to backfill orgId on system ${item.SK}:`,
          err,
        );
        failureCount += 1;
      }
    }

    lastEvaluatedKey = response.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (lastEvaluatedKey);

  console.log(`Backfilled orgId on ${backfilledSystems} legacy system(s).`);

  if (failureCount > 0) {
    throw new Error(`Seeding had ${failureCount} failure(s)`);
  }

  console.log("Seeding complete");
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
