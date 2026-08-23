import postgres from "postgres";

const url = Deno.env.get("DATABASE_URL");
if (!url) throw new Error("DATABASE_URL is not set");

export const sql = postgres(url, {
  max: 10,
  onnotice: () => {},
});

/** app_settings with a 30s cache — runtime toggles only, never secrets. */
const settingsCache = { at: 0, data: {} as Record<string, string> };

export async function appSettings(): Promise<Record<string, string>> {
  if (Date.now() - settingsCache.at < 30_000) return settingsCache.data;
  const rows = await sql`SELECT key, value FROM app_settings`;
  settingsCache.data = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  settingsCache.at = Date.now();
  return settingsCache.data;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  settingsCache.at = 0;
}
