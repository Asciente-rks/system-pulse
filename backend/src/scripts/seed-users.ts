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

  // 1) Demo organization (hosts the platform owner's personal projects).
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
          ownerId: "seed-superadmin",
          createDate: now,
        },
      }),
    );
    console.log("Seeded demo organization");
  } catch (err) {
    console.error("Failed to seed demo organization:", err);
    failureCount += 1;
  }

  // 2) Seed users (kept for backwards compatibility with existing
  //    quick-login dev tools). All scoped to the demo org so the
  //    classic "Tester" / "Admin" buttons land inside the showcase.
  const users = [
    {
      id: "seed-superadmin",
      email: "superadmin@example.local",
      full_name: "Super Admin",
      role: "superadmin",
      status_: "Active",
      createDate: now,
      allowedSystemIds: [],
      // Superadmin is platform-wide; no orgId needed.
    },
    {
      id: "seed-admin",
      email: "admin@example.local",
      full_name: "Admin User",
      role: "admin",
      status_: "Active",
      createDate: now,
      allowedSystemIds: [],
      orgId: DEMO_ORG_ID,
    },
    {
      id: "seed-tester",
      email: "tester@example.local",
      full_name: "Tester User",
      role: "tester",
      status_: "Active",
      createDate: now,
      allowedSystemIds: [],
      orgId: DEMO_ORG_ID,
    },
  ];

  for (const u of users) {
    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync("Password123!", salt, 64).toString("hex");
    const passwordHash = `${salt}:${derived}`;

    const item = {
      PK: "USER",
      SK: `USER#${u.id}`,
      entityType: "USER",
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      status_: u.status_,
      passwordHash,
      createDate: u.createDate,
      allowedSystemIds: u.allowedSystemIds,
      ...(u.orgId ? { orgId: u.orgId } : {}),
    } as any;

    try {
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: item,
        }),
      );
      console.log(`Seeded user ${u.id}`);
    } catch (err) {
      console.error(`Failed to seed ${u.id}:`, err);
      failureCount += 1;
    }
  }

  // 3) Backfill orgId on any pre-existing systems so they show up
  //    correctly in the demo org. New systems created via the SaaS
  //    flow already carry orgId; this only patches legacy data.
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
