// Applies db/migrations/*.sql in filename order, once each (schema_migrations ledger).
import { sql } from "./db.ts";

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;

const applied = new Set(
  (await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename as string),
);

const dir = new URL("../db/migrations/", import.meta.url);
const files: string[] = [];
for await (const entry of Deno.readDir(dir)) {
  if (entry.isFile && entry.name.endsWith(".sql")) files.push(entry.name);
}
files.sort();

for (const file of files) {
  if (applied.has(file)) continue;
  const body = await Deno.readTextFile(new URL(file, dir));
  console.log(`applying ${file}…`);
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
  });
}

console.log(`done — ${files.length} migration(s) on record.`);
await sql.end();
