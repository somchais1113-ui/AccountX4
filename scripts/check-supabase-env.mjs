import { existsSync, readFileSync } from "node:fs";

const files = [".env.local", ".env", ".env.production"];
const env = {};

for (const file of files) {
  if (!existsSync(file)) continue;
  const body = readFileSync(file, "utf8");
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }
}

const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const publishable = env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const anon = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const fallback = env.VITE_SUPABASE_KEY || process.env.VITE_SUPABASE_KEY;
const clientKey = publishable || anon || fallback;

const issues = [];
if (!url) issues.push("Missing VITE_SUPABASE_URL");
if (!clientKey) issues.push("Missing VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY");
if (url && !/^https:\/\/[^\s]+\.supabase\.co$/.test(url)) {
  issues.push("VITE_SUPABASE_URL should look like https://PROJECT_REF.supabase.co");
}
if (clientKey && clientKey.startsWith("sb_secret_")) {
  issues.push("Do not use a Supabase secret/service-role key in frontend code");
}

if (issues.length) {
  console.error("❌ Supabase env is not ready:");
  for (const issue of issues) console.error(`   - ${issue}`);
  console.error("\nFix .env locally, or set the same VITE_* variables in Vercel and redeploy.");
  process.exit(1);
}

console.log("✅ Supabase env looks ready for Vite build.");
console.log(`   URL: ${url}`);
console.log(`   Key type: ${publishable ? "publishable" : anon ? "legacy anon" : "fallback VITE_SUPABASE_KEY"}`);
