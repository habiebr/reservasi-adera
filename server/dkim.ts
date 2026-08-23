/**
 * DKIM (RFC 6376) signing, relaxed/relaxed, rsa-sha256.
 *
 * Why we sign in-app at all: cPanel's Exim only DKIM-signs messages submitted locally (from
 * ::1, e.g. Roundcube). Mail we relay in over authenticated SMTP from the VPS goes out
 * unsigned, so it has to rely on SPF alone — and SPF is evaluated against Biznet Gio's
 * smarthost pool, whose IPs we don't control. A signature we attach ourselves travels with
 * the message and stays valid no matter which relay hands it to Gmail.
 */

// ── PEM/DER ──────────────────────────────────────────────────────────────────────

function pemBody(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** DER length octets: short form under 0x80, else long form. */
function derLen(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v = v >> 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

const der = (tag: number, content: Uint8Array): Uint8Array =>
  new Uint8Array([tag, ...derLen(content.length), ...content]);

/**
 * cPanel hands out a PKCS#1 key ("BEGIN RSA PRIVATE KEY"); WebCrypto only imports PKCS#8, so
 * wrap it: SEQUENCE { INTEGER 0, SEQUENCE { OID rsaEncryption, NULL }, OCTET STRING pkcs1 }.
 */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algId = der(0x30, new Uint8Array([
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // rsaEncryption
    0x05, 0x00, // NULL
  ]));
  const octet = der(0x04, pkcs1);
  return der(0x30, new Uint8Array([...version, ...algId, ...octet]));
}

export async function importDkimKey(pem: string): Promise<CryptoKey> {
  const raw = pemBody(pem);
  const pkcs8 = /BEGIN RSA PRIVATE KEY/.test(pem) ? pkcs1ToPkcs8(raw) : raw;
  return await crypto.subtle.importKey(
    "pkcs8",
    pkcs8 as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// ── canonicalization ─────────────────────────────────────────────────────────────

/** relaxed: lowercase name, unfold, collapse WSP runs, strip trailing WSP. */
const canonHeader = (name: string, value: string): string =>
  `${name.toLowerCase()}:${value.replace(/\r?\n[ \t]+/g, " ").replace(/[ \t]+/g, " ").trim()}`;

/**
 * relaxed: strip trailing WSP per line, collapse WSP runs, drop trailing empty lines, and
 * end with a single CRLF (an empty body canonicalizes to "").
 */
function canonBody(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").replace(/[ \t]+$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? lines.join("\r\n") + "\r\n" : "";
}

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s);
};

const sha256 = async (s: string): Promise<string> =>
  b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

// ── signing ──────────────────────────────────────────────────────────────────────

export interface DkimOptions {
  domain: string;
  selector: string;
  key: CryptoKey;
  /** Header names to sign, in order. Must all exist in `headers`. */
  headerNames: string[];
}

/**
 * Returns the full `DKIM-Signature: ...` header line (no trailing CRLF) to prepend to the
 * message. `headers` are the exact headers being sent, in send order.
 */
export async function dkimSignature(
  headers: Array<[string, string]>,
  body: string,
  opt: DkimOptions,
): Promise<string> {
  const bh = await sha256(canonBody(body));
  const present = opt.headerNames.filter((n) =>
    headers.some(([k]) => k.toLowerCase() === n.toLowerCase())
  );

  // b= is empty while signing, per RFC 6376 §3.7 — the verifier recomputes with it emptied.
  const base = `v=1; a=rsa-sha256; c=relaxed/relaxed; d=${opt.domain}; s=${opt.selector}; ` +
    `t=${Math.floor(Date.now() / 1000)}; h=${present.join(":")}; bh=${bh}; b=`;

  const signedHeaders = present.map((n) => {
    const hit = headers.find(([k]) => k.toLowerCase() === n.toLowerCase())!;
    return canonHeader(hit[0], hit[1]);
  }).join("\r\n");

  // The DKIM-Signature header itself is included, canonicalized, with no trailing CRLF.
  const toSign = `${signedHeaders}\r\n${canonHeader("DKIM-Signature", base)}`;

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    opt.key,
    new TextEncoder().encode(toSign),
  );
  return `DKIM-Signature: ${base}${b64(sig)}`;
}
