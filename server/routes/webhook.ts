// DOKU payment notification. Always answers 200 (DOKU retries otherwise); signature is
// verified before any write; the PAID flip is a single idempotent statement.
import { Hono } from "hono";
import { loadDokuCreds, verifyWebhookSignature } from "../doku.ts";
import { markExpired, markPaidAndSync } from "./booking.ts";

export const webhookRoutes = new Hono();

webhookRoutes.post("/doku", async (c) => {
  const bodyString = await c.req.text();
  const doku = await loadDokuCreds();
  if (!doku) return c.json({ ok: true });

  const valid = await verifyWebhookSignature(c.req.raw, bodyString, doku.secretKey);
  if (!valid) {
    console.warn("[webhook/doku] signature mismatch — ignored");
    return c.json({ ok: true });
  }

  let notification: Record<string, unknown>;
  try {
    notification = JSON.parse(bodyString);
  } catch {
    return c.json({ ok: true });
  }

  const order = (notification.order ?? {}) as Record<string, unknown>;
  const invoiceNumber = String(order.invoice_number ?? "");
  const txStatus = String(
    ((notification.transaction ?? {}) as Record<string, unknown>).status ?? "",
  ).toUpperCase();
  const orderStatus = String(order.status ?? "").toUpperCase();
  console.log(`[webhook/doku] ${invoiceNumber} tx=${txStatus} order=${orderStatus}`);

  if (!invoiceNumber.startsWith("RSV-")) return c.json({ ok: true });

  if (txStatus === "SUCCESS" || orderStatus === "PAID" || orderStatus === "SUCCESS") {
    await markPaidAndSync(invoiceNumber);
  } else if (txStatus === "EXPIRED" || txStatus === "FAILED" || orderStatus === "EXPIRED") {
    await markExpired(invoiceNumber);
  }
  return c.json({ ok: true });
});
