// Admin auth: admin_users (bcrypt) + an HS256 JWT in an HttpOnly cookie.
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import bcrypt from "bcryptjs";
import { sql } from "./db.ts";

const COOKIE = "resv_admin";
const TTL_SECONDS = 60 * 60 * 12; // 12h

function secret(): string {
  const s = Deno.env.get("ADMIN_JWT_SECRET");
  if (!s || s.length < 16) throw new Error("ADMIN_JWT_SECRET missing or too short");
  return s;
}

const enc = new TextEncoder();
const b64url = (data: Uint8Array | ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface AdminClaims {
  sub: string; // admin_users.id
  email: string;
  name: string;
  exp: number;
}

async function signToken(claims: AdminClaims): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

async function verifyToken(token: string): Promise<AdminClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const pad = (s: string) => s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4);
  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(atob(pad(sig)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    sigBytes as BufferSource,
    enc.encode(`${head}.${body}`) as BufferSource,
  );
  if (!valid) return null;
  try {
    const claims = JSON.parse(atob(pad(body))) as AdminClaims;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function login(
  c: Context,
  email: string,
  password: string,
): Promise<AdminClaims | null> {
  const rows = await sql`
    SELECT id, email, password_hash, name FROM admin_users
    WHERE lower(email) = lower(${email}) AND is_active`;
  if (rows.length === 0) return null;
  const user = rows[0];
  if (!bcrypt.compareSync(password, user.password_hash as string)) return null;
  const claims: AdminClaims = {
    sub: user.id as string,
    email: user.email as string,
    name: user.name as string,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  setCookie(c, COOKIE, await signToken(claims), {
    httpOnly: true,
    sameSite: "Lax",
    secure: (Deno.env.get("APP_URL") ?? "").startsWith("https://"),
    path: "/",
    maxAge: TTL_SECONDS,
  });
  return claims;
}

export function logout(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Middleware: require a valid admin session; puts claims on c.var.admin. */
export async function requireAdmin(c: Context, next: Next) {
  const token = getCookie(c, COOKIE);
  const claims = token ? await verifyToken(token) : null;
  if (!claims) return c.json({ error: "Unauthorized" }, 401);
  c.set("admin", claims);
  await next();
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}
