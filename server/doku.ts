// DOKU hosted-checkout client, ported from the proven vaksinadera rail
// (create-registration + doku-notification). Same HMAC scheme on both directions.
import { appSettings } from "./db.ts";

export interface DokuCreds {
  baseUrl: string;
  clientId: string;
  secretKey: string;
  isSandbox: boolean;
}

export async function loadDokuCreds(): Promise<DokuCreds | null> {
  const settings = await appSettings().catch(() => ({} as Record<string, string>));
  const env = (settings["doku_env"] ?? Deno.env.get("DOKU_ENV") ?? "sandbox").toLowerCase();
  const isSandbox = env !== "production";
  const suffix = isSandbox ? "SANDBOX" : "PRODUCTION";
  const clientId = Deno.env.get(`DOKU_CLIENT_ID_${suffix}`) ?? "";
  const secretKey = Deno.env.get(`DOKU_SECRET_KEY_${suffix}`) ?? "";
  if (!clientId || !secretKey) return null;
  return {
    baseUrl: isSandbox ? "https://api-sandbox.doku.com" : "https://api.doku.com",
    clientId,
    secretKey,
    isSandbox,
  };
}

const b64 = (buf: ArrayBuffer) =>
  btoa(Array.from(new Uint8Array(buf)).map((b) => String.fromCharCode(b)).join(""));

async function hmacSignature(
  clientId: string,
  requestId: string,
  requestTimestamp: string,
  requestTarget: string,
  secretKey: string,
  bodyString: string,
): Promise<string> {
  const digest = b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bodyString)));
  const component = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${requestTarget}`,
    `Digest:${digest}`,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(component));
  return "HMACSHA256=" + b64(sig);
}

export function generateInvoiceNumber(): string {
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = Math.floor(Math.random() * 9000 + 1000);
  return `RSV-${ts}-${random}`;
}

export interface CheckoutResult {
  ok: true;
  paymentUrl: string;
}
export interface CheckoutFailure {
  ok: false;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string;
  raw: unknown;
}

export async function createCheckout(
  creds: DokuCreds,
  input: {
    invoiceNumber: string;
    amount: number;
    customer: { name: string; email?: string | null; phone?: string | null };
    callbackUrl: string;
    notificationUrl: string;
  },
): Promise<CheckoutResult | CheckoutFailure> {
  const requestId = crypto.randomUUID();
  const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const requestTarget = "/checkout/v1/payment";

  const body = {
    order: {
      invoice_number: input.invoiceNumber,
      amount: input.amount,
      callback_url: input.callbackUrl,
      callback_url_result: input.callbackUrl,
      auto_redirect: true,
    },
    customer: {
      name: input.customer.name,
      ...(input.customer.email ? { email: input.customer.email } : {}),
      ...(input.customer.phone ? { phone: input.customer.phone } : {}),
    },
    payment: {
      payment_due_date: 60, // minutes — bounds how long an unpaid booking can hold a slot
      payment_method_types: [
        "VIRTUAL_ACCOUNT_BCA",
        "VIRTUAL_ACCOUNT_BANK_MANDIRI",
        "VIRTUAL_ACCOUNT_BRI",
        "VIRTUAL_ACCOUNT_BNI",
        "VIRTUAL_ACCOUNT_BANK_PERMATA",
        "VIRTUAL_ACCOUNT_BANK_CIMB",
        "VIRTUAL_ACCOUNT_BANK_DANAMON",
        "VIRTUAL_ACCOUNT_DOKU",
        "VIRTUAL_ACCOUNT_BNC",
        "VIRTUAL_ACCOUNT_BTN",
        "QRIS",
      ],
    },
    notification_url: input.notificationUrl,
  };

  const bodyString = JSON.stringify(body);
  const signature = await hmacSignature(
    creds.clientId,
    requestId,
    requestTimestamp,
    requestTarget,
    creds.secretKey,
    bodyString,
  );

  let res: Response;
  try {
    res = await fetch(`${creds.baseUrl}${requestTarget}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Id": creds.clientId,
        "Request-Id": requestId,
        "Request-Timestamp": requestTimestamp,
        "Signature": signature,
      },
      body: bodyString,
    });
  } catch (err) {
    return { ok: false, httpStatus: null, errorCode: "network_error", errorMessage: String(err), raw: null };
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch { /* keep raw text below */ }

  const paymentUrl =
    (data.response as { payment?: { url?: string } } | undefined)?.payment?.url ?? null;
  if (!res.ok || !paymentUrl) {
    const err = (data.error ?? {}) as Record<string, unknown>;
    return {
      ok: false,
      httpStatus: res.status,
      errorCode: (err.code ?? data.code ?? null) as string | null,
      errorMessage: String(err.message ?? data.message ?? text.slice(0, 500)),
      raw: text ? { body: text.slice(0, 2000) } : null,
    };
  }
  return { ok: true, paymentUrl };
}

/**
 * Verify an incoming webhook. DOKU signs against the public URL path; behind a tunnel the
 * server may see a different internal path, so both are tried.
 */
export async function verifyWebhookSignature(
  req: Request,
  bodyString: string,
  secretKey: string,
  publicPath = "/api/webhooks/doku",
): Promise<boolean> {
  try {
    const clientId = req.headers.get("Client-Id") ?? "";
    const requestId = req.headers.get("Request-Id") ?? "";
    const requestTimestamp = req.headers.get("Request-Timestamp") ?? "";
    const received = req.headers.get("Signature") ?? "";
    const internalPath = new URL(req.url).pathname;
    for (const path of new Set([internalPath, publicPath])) {
      const digest = b64(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bodyString)),
      );
      const component = [
        `Client-Id:${clientId}`,
        `Request-Id:${requestId}`,
        `Request-Timestamp:${requestTimestamp}`,
        `Request-Target:${path}`,
        `Digest:${digest}`,
      ].join("\n");
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secretKey),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = "HMACSHA256=" +
        b64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(component)));
      if (sig === received) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Poll one order's status straight from DOKU (covers a lost webhook).
 * GET requests sign WITHOUT a Digest line (matches vaksinadera's check-payment-status). */
export async function fetchOrderStatus(
  creds: DokuCreds,
  invoiceNumber: string,
): Promise<{ status: string | null } | null> {
  const requestId = crypto.randomUUID();
  const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const requestTarget = `/orders/v1/status/${invoiceNumber}`;
  const component = [
    `Client-Id:${creds.clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${requestTarget}`,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(creds.secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = "HMACSHA256=" +
    b64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(component)));
  try {
    const res = await fetch(`${creds.baseUrl}${requestTarget}`, {
      headers: {
        "Client-Id": creds.clientId,
        "Request-Id": requestId,
        "Request-Timestamp": requestTimestamp,
        "Signature": signature,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { status: (data?.transaction?.status ?? data?.order?.status ?? null) as string | null };
  } catch {
    return null;
  }
}
