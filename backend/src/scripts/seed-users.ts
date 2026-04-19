import "dotenv/config";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../config/db.js";
import { scryptSync, randomBytes } from "crypto";

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

  const now = new Date().toISOString();
  let failureCount = 0;

  const users = [
    {
      id: "seed-superadmin",
      email: "superadmin@example.local",
      full_name: "Super Admin",
      role: "superadmin",
      status_: "Active",
      createDate: now,
      allowedSystemIds: [],
    },
    {
      id: "seed-admin",
      email: "admin@example.local",
      full_name: "Admin User",
      role: "admin",
      status_: "Active",
      createDate: now,
      allowedSystemIds: [],
    },
    {
      id: "seed-tester",
      email: "tester@example.local",
      full_name: "Tester User",
      role: "tester",
      status_: "Active",
      createDate: now,
      allowedSystemIds: [],
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

  if (failureCount > 0) {
    throw new Error(`Seeding failed for ${failureCount} user(s)`);
  }

  console.log("Seeding complete");
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
