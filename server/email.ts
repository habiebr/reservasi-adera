/**
 * Shared SMTP sender for transactional mail (cPanel mailbox), with in-app DKIM signing.
 *
 * Credentials live in clinic_secrets (`smtp_*`), like the Calq/Qontak ones, so they change
 * without a redeploy and never land in the repo. Sending relays through the cPanel mailbox
 * rather than straight out of this host — the domain's SPF authorises cPanel and its upstream
 * smarthosts, not us.
 *
 * We build the message and speak SMTP directly instead of using a mail library: a DKIM body
 * hash has to match the transmitted bytes exactly, so whatever encodes the MIME parts has to
 * be the same thing that computes the hash. See dkim.ts for why signing here matters at all.
 *
 * This is for transactional 1:1 mail — a reschedule decision, a booking confirmation. The
 * mailbox is on shared hosting that caps hourly volume and forbids bulk sending, so do NOT
 * route campaign blasts through here.
 */

import { dkimSignature, importDkimKey } from "./dkim.ts";

export interface SmtpCreds {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  /** Master switch: when false, senders skip quietly instead of mailing real patients. */
  enabled: boolean;
  /** PEM private key + selector. Absent = send unsigned (SPF-only). */
  dkimKey: string;
  dkimSelector: string;
}

const env = (k: string) => (Deno.env.get(k) ?? "").trim();

/**
 * A .env file can't carry the PEM's newlines, so the key is normally stored base64-encoded
 * (`base64 -w0 < key.pem`). A raw PEM — or one with literal \n escapes — is accepted too.
 */
function decodeDkimKey(raw: string): string {
  if (!raw) return "";
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n");
  try {
    return atob(raw.replace(/\s+/g, ""));
  } catch {
    console.error("[email] SMTP_DKIM_KEY is neither PEM nor valid base64; sending unsigned");
    return "";
  }
}

/**
 * Read from the environment (docker-compose `env_file: .env`) rather than clinic_secrets —
 * clinic_secrets is readable by any authenticated user under its RLS policy, which is no place
 * for a mailbox password or a DKIM private key. Changing these needs a `docker compose restart
 * functions`, unlike the Calq/Qontak settings.
 */
export function loadSmtpCreds(): SmtpCreds | null {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  if (!host || !user || !pass) return null;

  return {
    host,
    port: Number(env("SMTP_PORT")) || 465,
    user,
    pass,
    fromName: env("SMTP_SENDER_NAME") || "Klinik Adera",
    enabled: env("SMTP_ENABLED").toLowerCase() === "true",
    dkimKey: decodeDkimKey(env("SMTP_DKIM_KEY")),
    dkimSelector: env("SMTP_DKIM_SELECTOR") || "app",
  };
}

export interface SendResult { sent: boolean; message: string }

/** Basic sanity check — enough to skip the obvious junk (`gmail.con` typos still pass). */
export const looksLikeEmail = (v: string | null | undefined): boolean =>
  /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test((v ?? "").trim());

// ── message building ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** base64 body, hard-wrapped at 76 chars — deterministic, so the DKIM hash is stable. */
const b64Lines = (text: string): string =>
  (b64(enc.encode(text)).match(/.{1,76}/g) ?? []).join("\r\n");

/** RFC 2047 encoded-word, only when the value isn't plain ASCII. */
const encodeWord = (v: string): string =>
  /^[\x20-\x7E]*$/.test(v) ? v : `=?UTF-8?B?${b64(enc.encode(v))}?=`;

/** RFC 2822 date — toUTCString() is close but ends in "GMT" rather than a numeric offset. */
const rfc2822Date = (d: Date): string => d.toUTCString().replace(/GMT$/, "+0000");

function buildMessage(
  creds: SmtpCreds,
  to: string,
  subject: string,
  text: string,
  html?: string,
): { headers: Array<[string, string]>; body: string } {
  const domain = creds.user.split("@")[1] ?? "localhost";
  const boundary = `_b${crypto.randomUUID().replace(/-/g, "")}`;

  const headers: Array<[string, string]> = [
    ["From", `${encodeWord(creds.fromName)} <${creds.user}>`],
    ["To", to],
    ["Subject", encodeWord(subject)],
    ["Date", rfc2822Date(new Date())],
    ["Message-ID", `<${crypto.randomUUID()}@${domain}>`],
    ["MIME-Version", "1.0"],
  ];

  let body: string;
  if (html) {
    headers.push(["Content-Type", `multipart/alternative; boundary="${boundary}"`]);
    body = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64Lines(text),
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64Lines(html),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  } else {
    headers.push(["Content-Type", "text/plain; charset=utf-8"]);
    headers.push(["Content-Transfer-Encoding", "base64"]);
    body = b64Lines(text) + "\r\n";
  }
  return { headers, body };
}

// ── minimal SMTP client ──────────────────────────────────────────────────────────

class SmtpConn {
  private buf = "";
  private dec = new TextDecoder();
  constructor(private conn: Deno.Conn) {}

  /** Swap in the TLS-wrapped connection after a STARTTLS handshake. */
  upgrade(conn: Deno.Conn): void {
    this.conn = conn;
    this.buf = "";
  }

  /** Reads one complete reply; a multiline reply ends at "NNN " (space, not hyphen). */
  async reply(): Promise<{ code: number; text: string }> {
    for (;;) {
      const lines = this.buf.split("\r\n");
      for (let i = 0; i < lines.length; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const text = lines.slice(0, i + 1).join("\n");
          this.buf = lines.slice(i + 1).join("\r\n");
          return { code: Number(lines[i].slice(0, 3)), text };
        }
      }
      const chunk = new Uint8Array(4096);
      const n = await this.conn.read(chunk);
      if (n === null) throw new Error("koneksi SMTP terputus");
      this.buf += this.dec.decode(chunk.subarray(0, n));
    }
  }

  async send(s: string): Promise<void> {
    await this.conn.write(enc.encode(s));
  }

  async cmd(s: string, expect: number[]): Promise<{ code: number; text: string }> {
    await this.send(s + "\r\n");
    const r = await this.reply();
    if (!expect.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.text.slice(0, 160)}`);
    return r;
  }

  close(): void {
    try { this.conn.close(); } catch { /* already gone */ }
  }
}

/**
 * Compose the exact bytes we put on the wire, DKIM-signed when a key is configured.
 * Exported so the signature can be verified against a real DKIM verifier in tests.
 */
export async function composeMessage(
  creds: SmtpCreds,
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<{ wire: string; signed: boolean }> {
  const { headers, body } = buildMessage(creds, to, subject, text, html);

  // Sign before transmission. An unusable key must not silently cost us the message —
  // fall back to sending unsigned (SPF still applies) and surface it in the log.
  let signature = "";
  if (creds.dkimKey) {
    try {
      signature = await dkimSignature(headers, body, {
        domain: creds.user.split("@")[1] ?? "",
        selector: creds.dkimSelector,
        key: await importDkimKey(creds.dkimKey),
        headerNames: ["from", "to", "subject", "date", "message-id", "mime-version", "content-type"],
      }) + "\r\n";
    } catch (e) {
      console.error("[email] DKIM signing failed, sending unsigned:", (e as Error).message);
    }
  }

  const wire = signature +
    headers.map(([k, v]) => `${k}: ${v}`).join("\r\n") +
    "\r\n\r\n" + body;
  return { wire, signed: !!signature };
}

/**
 * Send one message. Best-effort by contract: it resolves with `sent:false` and a reason
 * rather than throwing, so a caller can never have a mail failure break its real work.
 */
export async function sendEmail(
  creds: SmtpCreds,
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<SendResult> {
  if (!looksLikeEmail(to)) return { sent: false, message: "alamat email tidak valid" };

  let smtp: SmtpConn | null = null;
  try {
    const { wire, signed } = await composeMessage(creds, to, subject, text, html);

    const ehlo = `EHLO ${creds.user.split("@")[1] ?? "localhost"}`;

    // 465 is implicit TLS. Anything else (587) starts plain and MUST be upgraded via STARTTLS
    // before authenticating — we never put credentials on an unencrypted connection.
    if (creds.port === 465) {
      smtp = new SmtpConn(await Deno.connectTls({ hostname: creds.host, port: creds.port }));
      await smtp.reply(); // greeting
      await smtp.cmd(ehlo, [250]);
    } else {
      const plain = await Deno.connect({ hostname: creds.host, port: creds.port });
      smtp = new SmtpConn(plain);
      await smtp.reply(); // greeting
      const greet = await smtp.cmd(ehlo, [250]);
      if (!/STARTTLS/i.test(greet.text)) {
        throw new Error("server tidak mendukung STARTTLS; gunakan port 465");
      }
      await smtp.cmd("STARTTLS", [220]);
      smtp.upgrade(await Deno.startTls(plain, { hostname: creds.host }));
      await smtp.cmd(ehlo, [250]); // re-EHLO inside the TLS session
    }
    await smtp.cmd("AUTH LOGIN", [334]);
    await smtp.cmd(b64(enc.encode(creds.user)), [334]);
    await smtp.cmd(b64(enc.encode(creds.pass)), [235]);
    await smtp.cmd(`MAIL FROM:<${creds.user}>`, [250]);
    await smtp.cmd(`RCPT TO:<${to}>`, [250, 251]);
    await smtp.cmd("DATA", [354]);
    // Dot-stuffing: a line that is just "." would otherwise end the message early.
    await smtp.send(wire.replace(/\r\n\./g, "\r\n..") + "\r\n.\r\n");
    const done = await smtp.reply();
    if (done.code !== 250) throw new Error(`SMTP ${done.code}: ${done.text.slice(0, 160)}`);
    try { await smtp.cmd("QUIT", [221]); } catch { /* server may just drop */ }

    return { sent: true, message: signed ? "OK (DKIM signed)" : "OK (unsigned)" };
  } catch (e) {
    return { sent: false, message: (e as Error).message?.slice(0, 200) ?? "gagal mengirim email" };
  } finally {
    smtp?.close();
  }
}
