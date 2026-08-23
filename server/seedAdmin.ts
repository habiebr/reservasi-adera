// deno task seed-admin <email> <password> [name]
import { sql } from "./db.ts";
import { hashPassword } from "./auth.ts";

const [email, password, name] = Deno.args;
if (!email || !password) {
  console.error("usage: deno task seed-admin <email> <password> [name]");
  Deno.exit(1);
}

await sql`
  INSERT INTO admin_users (email, password_hash, name)
  VALUES (${email.toLowerCase()}, ${hashPassword(password)}, ${name ?? ""})
  ON CONFLICT (email) DO UPDATE
    SET password_hash = EXCLUDED.password_hash, is_active = true`;

console.log(`admin ${email} siap.`);
await sql.end();
