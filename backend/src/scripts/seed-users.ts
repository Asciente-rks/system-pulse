import "dotenv/config";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { docClient } from "../config/db.js";
import { scryptSync, randomBytes } from "crypto";
import { DEMO_ORG_ID } from "../types/organization.js";
import { DEFAULT_PERMISSIONS_BY_ROLE } from "../types/user.js";

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
          id: DEMO_ORG_ID,
          name: "System Pulse Demo",
          slug: "demo",
          isDemo: true,
          // ownerId is left as the literal "platform" sentinel
          // because there is no real human owning the demo org —
          // the platform itself does.
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

  await seedAccount({
    id: "seed-superadmin",
    email: process.env.SEED_SUPERADMIN_EMAIL,
    password: process.env.SEED_SUPERADMIN_PASSWORD,
    full_name: process.env.SEED_SUPERADMIN_NAME || "Platform Admin",
    role: "superadmin",
    // Superadmin is platform-wide; no orgId.
  });

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
