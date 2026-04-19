import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../config/db.ts";
import { scryptSync, randomBytes } from "crypto";

async function seed() {
  const tableName = process.env.USERS_TABLE || process.env.TABLE_NAME;
  if (!tableName) {
    console.error("USERS_TABLE or TABLE_NAME env var must be set");
    process.exit(1);
  }

  const now = new Date().toISOString();

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
    // derive passwordHash for seeded users (default password: Password123!)
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
    }
  }

  console.log("Seeding complete");
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
