// Promo vouchers (db/migrations/0010_promo_vouchers.sql).
// Buy: form → DOKU checkout (VCR- invoice) → PAID (webhook, status poll or sweeper) →
// 8-digit voucher + email. Redeem (admin, at the clinic): Calq patient → sale (PRODUCT at the
// promo price) → payment. Each Calq step is latched on promo_orders, so a retry resumes.
import { appSettings, sql } from "./db.ts";
import { createCheckout, fetchOrderStatus, loadDokuCreds } from "./doku.ts";
import {
  CalqError,
  createCalqPatient,
  createSale,
  findCalqPatientByNik,
  getSale,
  isFullyPaid,
  loadCalqCreds,
  postSalePayment,
} from "./calq.ts";
import { loadSmtpCreds, looksLikeEmail, sendEmail } from "./email.ts";
import { canonPhone, isValidNik, isValidTanggalLahir, maskName } from "../shared/identity.ts";

export interface Campaign {
  id: string;
  title: string;
  product_label: string;
  calq_product_id: number | null;
  price_normal: number;
  price_promo: number;
  sale_starts: Date;
  sale_ends: Date;
  redeem_until: Date;
  visit_period: string;
  active: boolean;
}

export const promoPublicUrl = () =>
  (Deno.env.get("PROMO_PUBLIC_URL") ?? "https://promo.klinikadera.co.id").replace(/\/+$/, "");

export async function getCampaign(id: string): Promise<Campaign | null> {
  const rows = await sql`SELECT * FROM promo_campaigns WHERE id = ${id}`;
  return (rows[0] as unknown as Campaign) ?? null;
}

/** upcoming | open | closed. PROMO_FORCE_OPEN=true opens the window (sandbox testing only). */
export function saleState(c: Campaign, now = new Date()): "upcoming" | "open" | "closed" {
  if (!c.active) return "closed";
  if (Deno.env.get("PROMO_FORCE_OPEN") === "true") return "open";
  if (now < new Date(c.sale_starts)) return "upcoming";
  if (now >= new Date(c.sale_ends)) return "closed";
  return "open";
}

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0"))
    .join("");

function voucherInvoice(): string {
  const d = new Date(Date.now() + 7 * 3600_000); // WIB
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, "");
  return `VCR-${ymd}-${randomHex(4).toUpperCase()}`;
}

export interface OrderInput {
  nama: string;
  nik: string;
  dob: string;
  sex: string;
  phone: string;
  email?: string;
  consent?: boolean;
}

export async function createOrder(
  campaignId: string,
  input: OrderInput,
): Promise<{ ok: true; paymentUrl: string; token: string } | { ok: false; status: number; error: string }> {
  const c = await getCampaign(campaignId);
  if (!c) return { ok: false, status: 404, error: "Promo tidak ditemukan." };
  const state = saleState(c);
  if (state === "upcoming") return { ok: false, status: 409, error: "Promo belum dimulai." };
  if (state === "closed") return { ok: false, status: 409, error: "Promo telah berakhir." };

  const nama = String(input.nama ?? "").trim().replace(/\s+/g, " ");
  const nik = String(input.nik ?? "").replace(/\D/g, "");
  const dob = String(input.dob ?? "").trim();
  const sex = input.sex === "MALE" || input.sex === "FEMALE" ? input.sex : "";
  const phone = canonPhone(input.phone);
  const email = String(input.email ?? "").trim();
  if (nama.length < 2) return { ok: false, status: 400, error: "Nama wajib diisi." };
  if (!isValidNik(nik)) return { ok: false, status: 400, error: "NIK harus 16 digit." };
  if (!isValidTanggalLahir(dob)) return { ok: false, status: 400, error: "Tanggal lahir tidak valid." };
  if (!sex) return { ok: false, status: 400, error: "Pilih jenis kelamin." };
  if (!phone || phone.length < 10) return { ok: false, status: 400, error: "Nomor WhatsApp tidak valid." };
  if (email && !looksLikeEmail(email)) return { ok: false, status: 400, error: "Email tidak valid." };
  if (!input.consent) return { ok: false, status: 400, error: "Centang persetujuan terlebih dahulu." };

  // One voucher per NIK per campaign: a paid one blocks; a still-pending one is reused.
  const prior = await sql`
    SELECT token, status, payment_url FROM promo_orders
    WHERE campaign_id = ${c.id} AND nik = ${nik} AND status IN ('PAID','PENDING')
    ORDER BY created_at DESC LIMIT 1`;
  if (prior[0]?.status === "PAID") {
    return { ok: false, status: 409, error: "NIK ini sudah punya voucher promo. Cek WhatsApp atau email kamu." };
  }
  if (prior[0]?.status === "PENDING" && prior[0].payment_url) {
    return { ok: true, paymentUrl: String(prior[0].payment_url), token: String(prior[0].token) };
  }

  const doku = await loadDokuCreds();
  if (!doku) return { ok: false, status: 503, error: "Pembayaran belum tersedia. Coba lagi sebentar." };

  const token = randomHex(12);
  const invoiceNumber = voucherInvoice();
  await sql`
    INSERT INTO promo_orders (campaign_id, token, invoice_number, nama, nik, dob, sex, phone, email, amount)
    VALUES (${c.id}, ${token}, ${invoiceNumber}, ${nama}, ${nik}, ${dob}, ${sex}, ${phone},
            ${email || null}, ${c.price_promo})`;

  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
  const res = await createCheckout(doku, {
    invoiceNumber,
    amount: c.price_promo,
    customer: { name: nama, email: email || null, phone },
    callbackUrl: `${promoPublicUrl()}/v/${token}`,
    notificationUrl: `${appUrl}/api/webhooks/doku`,
  });
  if (!res.ok) {
    console.error(`[promo] checkout ${invoiceNumber} failed:`, res.errorCode, res.errorMessage);
    await sql`UPDATE promo_orders SET status = 'EXPIRED' WHERE invoice_number = ${invoiceNumber}`;
    return { ok: false, status: 502, error: "Gagal membuat pembayaran. Coba lagi." };
  }
  await sql`UPDATE promo_orders SET payment_url = ${res.paymentUrl} WHERE invoice_number = ${invoiceNumber}`;
  return { ok: true, paymentUrl: res.paymentUrl, token };
}

async function newVoucherCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 90_000_000 + 10_000_000;
    const code = String(n);
    const taken = await sql`SELECT 1 FROM promo_orders WHERE voucher_code = ${code}`;
    if (taken.length === 0) return code;
  }
  throw new Error("could not mint a unique voucher code");
}

/** Idempotent: PENDING → PAID + voucher code, then notify. Safe from webhook, poll and sweeper. */
export async function markPromoPaid(invoiceNumber: string): Promise<void> {
  const code = await newVoucherCode();
  const rows = await sql`
    UPDATE promo_orders SET status = 'PAID', paid_at = now(), voucher_code = ${code}
    WHERE invoice_number = ${invoiceNumber} AND status IN ('PENDING','EXPIRED') AND voucher_code IS NULL
    RETURNING id`;
  if (rows.length === 0) return;
  console.log(`[promo] ${invoiceNumber} PAID → voucher issued`);
  notifyVoucher(String(rows[0].id)).catch((e) => console.error("[promo] notify crashed:", e));
}

export async function markPromoExpired(invoiceNumber: string): Promise<void> {
  await sql`UPDATE promo_orders SET status = 'EXPIRED' WHERE invoice_number = ${invoiceNumber} AND status = 'PENDING'`;
}

/** Ask DOKU directly — covers a webhook that went elsewhere or got lost. */
export async function pollPromoOrder(invoiceNumber: string): Promise<void> {
  const doku = await loadDokuCreds();
  if (!doku) return;
  const remote = await fetchOrderStatus(doku, invoiceNumber);
  const st = (remote?.status ?? "").toUpperCase();
  if (st === "SUCCESS" || st === "PAID") await markPromoPaid(invoiceNumber);
  else if (st === "EXPIRED" || st === "FAILED") await markPromoExpired(invoiceNumber);
}

/** Every minute: poll PENDING promo orders from the last 2 hours (DOKU due date is 60 min). */
export function startPromoSweeper(): void {
  const tick = async () => {
    try {
      const rows = await sql`
        SELECT invoice_number FROM promo_orders
        WHERE status = 'PENDING' AND created_at > now() - interval '2 hours'
        ORDER BY created_at LIMIT 50`;
      for (const r of rows) await pollPromoOrder(String(r.invoice_number));
      // Retry notifications that failed transiently (no email yet but address present).
      const pend = await sql`
        SELECT id FROM promo_orders
        WHERE status = 'PAID' AND email IS NOT NULL AND email_sent_at IS NULL
          AND (email_error IS NULL) AND paid_at < now() - interval '1 minute' LIMIT 20`;
      for (const p of pend) await notifyVoucher(String(p.id));
    } catch (e) {
      console.error("[promo] sweeper:", e);
    }
  };
  setInterval(tick, 60_000);
}

const rupiah = (n: number) => "Rp" + n.toLocaleString("id-ID");
const spacedCode = (code: string) => code.replace(/^(\d{4})(\d{4})$/, "$1 $2");
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));

function voucherEmail(o: Record<string, unknown>, c: Campaign) {
  const code = spacedCode(String(o.voucher_code));
  const link = `${promoPublicUrl()}/v/${o.token}`;
  const subject = `Kode voucher ${c.product_label.replace(/^Vaksin Influenza /, "")} kamu: ${code}`;
  const text = [
    `Halo Kak ${o.nama},`,
    `pembayaran kamu sudah kami terima. Ini voucher ${c.product_label} kamu.`,
    ``,
    `Kode voucher: ${code}`,
    `Datang kapan saja: ${c.visit_period}`,
    `Lokasi: Klinik Pratama Adera, Sleman`,
    `Dibayar: ${rupiah(Number(o.amount))} (gratis biaya admin & BHP)`,
    `No. pesanan: ${o.invoice_number}`,
    ``,
    `Buka voucher (dengan QR code): ${link}`,
    ``,
    `Bawa KTP asli sesuai NIK dan tunjukkan kode ini di pendaftaran. Vaksinasi didahului pemeriksaan singkat oleh dokter.`,
    ``,
    `Klinik Pratama Adera · WhatsApp 0811-1015-2170`,
  ].join("\n");
  const row = (k: string, v: string) =>
    `<tr><td style="padding:8px 0;color:#5B6478;width:42%">${k}</td><td style="padding:8px 0;font-weight:600">${v}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#EEF1F7;font-family:Arial,sans-serif;color:#0F2557">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border-radius:16px;overflow:hidden">
<div style="background:#C92A66;color:#fff;padding:20px 24px;font-size:22px;font-weight:800">Voucher ${esc(c.product_label)}</div>
<div style="padding:24px">
<p style="margin:0 0 16px;font-size:16px;line-height:1.6">Halo Kak <strong>${esc(String(o.nama))}</strong>,<br>pembayaran kamu sudah kami terima. Ini voucher vaksin influenza kamu.</p>
<div style="border:2px dashed #C9D1E0;border-radius:14px;padding:18px;text-align:center">
<div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#5B6478">KODE VOUCHER</div>
<div style="font-size:32px;font-weight:800;letter-spacing:.1em">${code}</div></div>
<table style="width:100%;border-collapse:collapse;font-size:15px;margin-top:16px">
${row("Datang kapan saja", esc(c.visit_period))}${row("Lokasi", "Klinik Pratama Adera, Sleman")}
${row("Dibayar", `${rupiah(Number(o.amount))} · gratis admin &amp; BHP`)}${row("No. pesanan", esc(String(o.invoice_number)))}</table>
<p style="margin:20px 0"><a href="${link}" style="background:#0033FF;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:8px;display:inline-block">Buka voucher</a></p>
<div style="background:#FFF8E6;border:1px solid #F3DFA8;border-radius:12px;padding:14px;font-size:14px;line-height:1.6;color:#7A3E00">Bawa <strong>KTP asli</strong> sesuai NIK dan tunjukkan kode ini di pendaftaran. Vaksinasi didahului pemeriksaan singkat oleh dokter.</div>
</div></div>
<p style="font-size:13px;color:#3B4458;text-align:center;line-height:1.6">Klinik Pratama Adera · Sleman, Yogyakarta<br>WhatsApp 0811-1015-2170 · Email ini dikirim otomatis.</p>
</div></body></html>`;
  return { subject, text, html };
}

/** Email via Resend when RESEND_API_KEY is set, else the app's SMTP. Best effort, latched. */
export async function notifyVoucher(orderId: string): Promise<void> {
  const rows = await sql`SELECT * FROM promo_orders WHERE id = ${orderId} AND status = 'PAID'`;
  const o = rows[0];
  if (!o || !o.email || o.email_sent_at) return;
  const c = await getCampaign(String(o.campaign_id));
  if (!c) return;
  const { subject, text, html } = voucherEmail(o, c);
  let sent = false;
  let message = "";
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("RESEND_FROM") ?? "Vaksin Adera <noreply@vaksin.klinikadera.co.id>",
          to: [String(o.email)],
          subject,
          text,
          html,
        }),
      });
      sent = res.ok;
      message = sent ? "resend ok" : `resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
    } catch (e) {
      message = `resend: ${(e as Error).message}`;
    }
  } else {
    const smtp = loadSmtpCreds();
    if (!smtp) message = "email belum dikonfigurasi";
    else {
      const r = await sendEmail(smtp, String(o.email), subject, text, html);
      sent = r.sent;
      message = r.message;
    }
  }
  if (sent) await sql`UPDATE promo_orders SET email_sent_at = now(), email_error = NULL WHERE id = ${orderId}`;
  else await sql`UPDATE promo_orders SET email_error = ${message} WHERE id = ${orderId}`;
  console.log(`[promo] email ${o.invoice_number}: ${sent ? "sent" : message}`);
}

/** Public voucher view. Polls DOKU first while still PENDING. */
export async function voucherView(token: string) {
  let rows = await sql`SELECT * FROM promo_orders WHERE token = ${token}`;
  if (!rows[0]) return null;
  if (rows[0].status === "PENDING") {
    await pollPromoOrder(String(rows[0].invoice_number)).catch(() => {});
    rows = await sql`SELECT * FROM promo_orders WHERE token = ${token}`;
  }
  const o = rows[0];
  const c = await getCampaign(String(o.campaign_id));
  return {
    status: o.status as string,
    first_name: String(o.nama).split(" ")[0],
    masked_name: maskName(String(o.nama)),
    nik_tail: String(o.nik).slice(-4),
    voucher_code: o.status === "PAID" ? spacedCode(String(o.voucher_code)) : null,
    invoice_number: o.invoice_number,
    amount: Number(o.amount),
    payment_url: o.status === "PENDING" ? o.payment_url : null,
    redeemed: !!o.calq_paid_at,
    product_label: c?.product_label ?? "",
    visit_period: c?.visit_period ?? "",
    redeem_until: c?.redeem_until ?? null,
    campaign_id: o.campaign_id,
  };
}

// ── Admin redeem ──

export async function redeemVoucher(
  code: string,
  adminEmail: string,
): Promise<{ ok: boolean; message: string; order?: Record<string, unknown> }> {
  const clean = code.replace(/\D/g, "");
  const rows = await sql`SELECT * FROM promo_orders WHERE voucher_code = ${clean} AND status = 'PAID'`;
  const o = rows[0];
  if (!o) return { ok: false, message: "Kode voucher tidak ditemukan atau belum lunas." };
  if (o.calq_paid_at) return { ok: true, message: "Voucher sudah ditukar.", order: o };
  const c = await getCampaign(String(o.campaign_id));
  if (!c) return { ok: false, message: "Promo tidak ditemukan." };
  if (!o.redeemed_at && new Date() > new Date(c.redeem_until)) {
    return { ok: false, message: "Voucher sudah melewati masa berlaku." };
  }
  if (!c.calq_product_id) {
    return { ok: false, message: "Produk Calq untuk promo ini belum diatur (Pengaturan promo)." };
  }
  const creds = await loadCalqCreds();
  if (!creds) return { ok: false, message: "Kredensial Calq belum diatur." };

  await sql`UPDATE promo_orders SET redeemed_at = COALESCE(redeemed_at, now()), redeemed_by = COALESCE(redeemed_by, ${adminEmail}) WHERE id = ${o.id}`;
  const fail = async (msg: string) => {
    await sql`UPDATE promo_orders SET redeem_error = ${msg} WHERE id = ${o.id}`;
    return { ok: false, message: msg };
  };
  const calqMsg = (prefix: string, e: unknown) =>
    `${prefix}: ${e instanceof CalqError ? e.message : (e as Error)?.message ?? String(e)}`.slice(0, 400);

  // 1 · patient (exact NIK, else create)
  let patientId = o.calq_patient_id as string | null;
  if (!patientId) {
    try {
      const found = await findCalqPatientByNik(creds, String(o.nik));
      const p = found ?? await createCalqPatient(creds, {
        firstName: String(o.nama).split(" ")[0],
        ...(String(o.nama).includes(" ") ? { lastName: String(o.nama).split(" ").slice(1).join(" ") } : {}),
        identityNumber: String(o.nik),
        dateOfBirth: new Date(o.dob as string).toISOString().slice(0, 10),
        gender: o.sex as "MALE" | "FEMALE",
        mobilePhone: String(o.phone),
        whatsappNumber: String(o.phone),
        ...(o.email ? { email: String(o.email) } : {}),
      });
      patientId = String(p.id);
      await sql`UPDATE promo_orders SET calq_patient_id = ${patientId}, calq_mrn = ${p.medicalRecordNumber ?? null} WHERE id = ${o.id}`;
    } catch (e) {
      return fail(calqMsg("Pasien Calq gagal", e));
    }
  }

  // 2 · sale with the promo product at the promo price (no admin / BHP lines)
  let saleId = o.calq_sale_id as string | null;
  if (!saleId) {
    try {
      const sale = await createSale(creds, {
        patientId: Number(patientId),
        items: [{ referenceType: "PRODUCT", referenceId: c.calq_product_id, quantity: 1, unitPrice: c.price_promo, package: "BIG" }],
        branchId: Number(Deno.env.get("CALQ_BRANCH_ID") ?? "1") || 1,
        // Calq wants a room on PRODUCT lines too; same default room the booking sync uses.
        roomId: Number((await appSettings().catch(() => ({} as Record<string, string>)))["calq_default_room_id"] ??
          Deno.env.get("CALQ_DEFAULT_ROOM_ID") ?? "") || null,
        notes: `Voucher ${c.title} ${o.invoice_number} (kode ${o.voucher_code}), harga normal ${rupiah(c.price_normal)}`,
      });
      if (!sale?.id) return fail("POST /sales tidak mengembalikan id invoice");
      saleId = String(sale.id);
      await sql`UPDATE promo_orders SET calq_sale_id = ${saleId}, calq_invoice_no = ${sale.invoiceNumber ?? null} WHERE id = ${o.id}`;
    } catch (e) {
      return fail(calqMsg("Invoice Calq gagal", e));
    }
  }

  // 3 · payment (guard: never pay a PAID or empty sale)
  try {
    const sale = await getSale(creds, saleId);
    if (!isFullyPaid(sale.status)) {
      if ((sale.items ?? []).length === 0) return fail(`Sale ${saleId} tanpa item — pembayaran ditahan`);
      await postSalePayment(creds, saleId, {
        amount: Number(o.amount),
        type: "REGULAR",
        note: `${o.invoice_number} DOKU`,
        ...(o.paid_at ? { paidAt: new Date(o.paid_at as string).toISOString() } : {}),
      });
    }
    await sql`UPDATE promo_orders SET calq_paid_at = now(), redeem_error = NULL,
      calq_invoice_no = COALESCE(calq_invoice_no, ${sale.invoiceNumber ?? null}) WHERE id = ${o.id}`;
  } catch (e) {
    return fail(calqMsg("Pembayaran Calq gagal", e));
  }
  const done = await sql`SELECT * FROM promo_orders WHERE id = ${o.id}`;
  return { ok: true, message: "Voucher ditukar, Calq lunas.", order: done[0] };
}
