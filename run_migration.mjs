/**
 * Run all FinAnalytics SQL migrations against Supabase
 * using the Management API (requires a Supabase access token).
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=<token> node run_migration.mjs
 *
 * Or supply inline:
 *   node run_migration.mjs <access_token>
 */

import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT_REF = "detvrchwmedexphzxymd";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.argv[2];

if (!ACCESS_TOKEN) {
  console.error("❌  No access token provided.");
  console.error("   Get it from Supabase Dashboard → Account → Access Tokens");
  console.error("   Usage: SUPABASE_ACCESS_TOKEN=sbp_xxx node run_migration.mjs");
  process.exit(1);
}

const migrationsDir = join(__dirname, "supabase/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (!migrations.length) {
  console.error("❌  No SQL migrations found.");
  process.exit(1);
}

for (const file of migrations) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  console.log(`🚀  Running migration: ${file}`);

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  const body = await res.text();

  if (!res.ok) {
    console.error(`❌  Migration failed: ${file}`);
    console.error(res.status, body);
    process.exit(1);
  }

  console.log(`✅  Applied: ${file}`);
}

console.log("✅  All migrations applied successfully.");
