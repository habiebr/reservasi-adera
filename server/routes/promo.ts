import { Hono } from "hono";
// @ts-types="npm:@types/qrcode@1.5.5"
import QRCode from "npm:qrcode@1.5.4";
import { sql } from "../db.ts";
import { requireAdmin, type AdminClaims } from "../auth.ts";
import { createOrder, getCampaign, redeemVoucher, saleState, voucherView } from "../promo.ts";
import { findCalqPatientByNik, loadCalqCreds } from "../calq.ts";

// ── Public: /api/promo/* ──
export const promoRoutes = new Hono();

// Light per-IP throttle on order creation (NIK goes in; keep enumeration expensive).
const hits = new Map<string, { n: number; at: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 10 * 60_000) {
    hits.set(ip, { n: 1, at: now });
    return false;
  }
  h.n++;
  return h.n > 20;
}

promoRoutes.get("/:id", async (c) => {
  const camp = await getCampaign(c.req.param("id"));
  if (!camp) return c.json({ error: "Promo tidak ditemukan" }, 404);
  return c.json({
    id: camp.id,
    title: camp.title,
    product_label: camp.product_label,
    price_normal: camp.price_normal,
    price_promo: camp.price_promo,
    sale_starts: camp.sale_starts,
    sale_ends: camp.sale_ends,
    redeem_until: camp.redeem_until,
    visit_period: camp.visit_period,
    state: saleState(camp),
    now: new Date().toISOString(),
  });
});

promoRoutes.post("/:id/order", async (c) => {
  const ip = c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0] ?? "?";
  if (throttled(ip)) return c.json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, 429);
  const body = await c.req.json().catch(() => ({}));
  const res = await createOrder(c.req.param("id"), body);
  if (!res.ok) return c.json({ error: res.error }, res.status as 400);
  return c.json({ payment_url: res.paymentUrl, token: res.token });
});

promoRoutes.get("/voucher/:token", async (c) => {
  const v = await voucherView(c.req.param("token"));
  if (!v) return c.json({ error: "Voucher tidak ditemukan" }, 404);
  return c.json(v);
});

// QR of the voucher code (what the admin scans/types). Only for PAID vouchers.
promoRoutes.get("/voucher/:token/qr.svg", async (c) => {
  const rows = await sql`SELECT voucher_code FROM promo_orders WHERE token = ${c.req.param("token")} AND status = 'PAID'`;
  if (!rows[0]?.voucher_code) return c.text("not found", 404);
  const svg: string = await QRCode.toString(String(rows[0].voucher_code), { type: "svg", margin: 1, width: 240 });
  return c.body(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=86400" });
});

// ── Admin: /api/admin/promo/* ──
export const promoAdminRoutes = new Hono<{ Variables: { admin: AdminClaims } }>();
promoAdminRoutes.use("*", requireAdmin);

promoAdminRoutes.get("/:id/vouchers", async (c) => {
  const id = c.req.param("id");
  const camp = await getCampaign(id);
  if (!camp) return c.json({ error: "Promo tidak ditemukan" }, 404);
  const rows = await sql`
    SELECT invoice_number, nama, nik, phone, email, status, amount, paid_at, voucher_code,
           email_sent_at, email_error, redeemed_at, redeemed_by, calq_mrn, calq_invoice_no,
           calq_paid_at, redeem_error, created_at
    FROM promo_orders WHERE campaign_id = ${id} AND status <> 'EXPIRED'
    ORDER BY created_at DESC LIMIT 1000`;
  const stats = await sql`
    SELECT count(*) FILTER (WHERE status = 'PAID') AS sold,
           count(*) FILTER (WHERE calq_paid_at IS NOT NULL) AS redeemed,
           coalesce(sum(amount) FILTER (WHERE status = 'PAID'), 0) AS revenue
    FROM promo_orders WHERE campaign_id = ${id}`;
  return c.json({ campaign: { ...camp, state: saleState(camp) }, stats: stats[0], orders: rows });
});

promoAdminRoutes.get("/voucher/:code", async (c) => {
  const code = c.req.param("code").replace(/\D/g, "");
  const rows = await sql`SELECT * FROM promo_orders WHERE voucher_code = ${code}`;
  const o = rows[0];
  if (!o) return c.json({ error: "Kode voucher tidak ditemukan." }, 404);
  const camp = await getCampaign(String(o.campaign_id));
  let calq: { found: boolean; mrn?: string | null; dob_match?: boolean } | null = null;
  if (!o.calq_patient_id) {
    const creds = await loadCalqCreds();
    const p = creds ? await findCalqPatientByNik(creds, String(o.nik)).catch(() => null) : null;
    calq = p
      ? {
        found: true,
        mrn: p.medicalRecordNumber ?? null,
        dob_match: String(p.dateOfBirth ?? "").slice(0, 10) === new Date(o.dob).toISOString().slice(0, 10),
      }
      : { found: false };
  }
  return c.json({ order: o, campaign: camp, calq });
});

promoAdminRoutes.post("/voucher/:code/redeem", async (c) => {
  const res = await redeemVoucher(c.req.param("code"), c.get("admin").email);
  return c.json(res, res.ok ? 200 : 409);
});

promoAdminRoutes.put("/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const camp = await getCampaign(id);
  if (!camp) return c.json({ error: "Promo tidak ditemukan" }, 404);
  const num = (v: unknown, cur: number | null) =>
    v === undefined ? cur : v === null || v === "" ? null : Number(v);
  const productId = num(b.calq_product_id, camp.calq_product_id);
  const normal = num(b.price_normal, camp.price_normal);
  const promo = num(b.price_promo, camp.price_promo);
  if (!promo || promo <= 0 || !normal) return c.json({ error: "Harga tidak valid." }, 400);
  await sql`
    UPDATE promo_campaigns SET
      calq_product_id = ${productId},
      price_normal = ${normal},
      price_promo = ${promo},
      active = ${b.active === undefined ? camp.active : !!b.active},
      sale_starts = ${b.sale_starts ?? camp.sale_starts},
      sale_ends = ${b.sale_ends ?? camp.sale_ends},
      redeem_until = ${b.redeem_until ?? camp.redeem_until},
      updated_at = now()
    WHERE id = ${id}`;
  return c.json({ ok: true, campaign: await getCampaign(id) });
});
