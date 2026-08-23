// Post-payment Calq write-back. Idempotent and resumable: every step latches its result
// into booking_emr, so a webhook redelivery or an admin retry resumes where it died.
//
// House rules (proven in vaksinadera, verified against the sandbox):
// - Creating an appointment AUTO-CREATES its sale; never POST /sales ourselves.
// - Items BEFORE payments — paying an empty invoice makes Calq mark a Rp0 invoice PAID.
// - A sale whose status is already PAID is settled: never patch it, never pay it again.
// - Never delete an appointment (it owns procedure_result rows); recovery is
//   change-schedule in Calq + retry here.
import { appSettings, sql } from "./db.ts";
import {
  CalqError,
  createAppointment,
  createSale,
  findExistingSale,
  getAppointment,
  getSale,
  isFullyPaid,
  loadCalqCreds,
  postSalePayment,
  replaceSaleItems,
} from "./calq.ts";
import { loadSmtpCreds, looksLikeEmail, sendEmail } from "./email.ts";
import { renderInvoiceEmail } from "./emailTemplates.ts";
import { groupBookingItemRows } from "./bundles.ts";

/** Sale lines per procedure; the same procedure arriving via two bundles merges into one
 * line with summed quantity (Calq expects one row per referenceId). */
function mergedProcedureItems(
  rows: readonly Record<string, unknown>[],
): { referenceType: string; referenceId: number; quantity: number; unitPrice: number }[] {
  const byId = new Map<number, { referenceType: string; referenceId: number; quantity: number; unitPrice: number }>();
  for (const r of rows) {
    const id = Number(r.procedure_id);
    const existing = byId.get(id);
    if (existing) existing.quantity += Number(r.quantity);
    else {
      byId.set(id, {
        referenceType: "PROCEDURE",
        referenceId: id,
        quantity: Number(r.quantity),
        unitPrice: Number(r.unit_price),
      });
    }
  }
  return [...byId.values()];
}

async function recordFailure(bookingId: string, error: string): Promise<void> {
  console.error(`[emr-sync] ${bookingId} FAILED: ${error}`);
  await sql`
    UPDATE booking_emr
    SET sync_status = 'FAILED', error = ${error.slice(0, 2000)}, error_at = now(), updated_at = now()
    WHERE booking_id = ${bookingId}`;
}

function describeCalqError(prefix: string, err: unknown): string {
  if (err instanceof CalqError) {
    const reqId = (err.body as { requestId?: string })?.requestId;
    return `${prefix}: HTTP ${err.status} — ${err.message}${reqId ? ` (requestId ${reqId})` : ""}`;
  }
  return `${prefix}: ${String(err)}`;
}

export async function runEmrSync(bookingId: string): Promise<{ ok: boolean; message: string }> {
  const rows = await sql`
    SELECT b.*, p.invoice_number, p.jenis_pembayaran, p.amount_due, p.total_amount, p.paid_at,
           p.status AS payment_status,
           e.appointment_id, e.booking_code, e.queue_number, e.sale_id, e.sale_invoice_number,
           e.payment_posted_at, e.sync_status,
           bp.nama_lengkap, bp.email, bp.mrn
    FROM bookings b
    JOIN booking_payments p ON p.booking_id = b.id
    LEFT JOIN booking_emr e ON e.booking_id = b.id
    LEFT JOIN booking_patients bp ON bp.booking_id = b.id
    WHERE b.id = ${bookingId}`;
  if (rows.length === 0) return { ok: false, message: "booking tidak ditemukan" };
  const bk = rows[0];

  if (bk.payment_status !== "PAID" || bk.status !== "CONFIRMED") {
    return { ok: false, message: "belum dibayar" };
  }
  if (bk.sync_status === "REGISTERED") return { ok: true, message: "sudah tersinkron" };

  await sql`
    INSERT INTO booking_emr (booking_id, sync_status) VALUES (${bookingId}, 'PENDING')
    ON CONFLICT (booking_id) DO NOTHING`;

  const creds = await loadCalqCreds();
  if (!creds) {
    await recordFailure(bookingId, "Kredensial Calq tidak tersedia");
    return { ok: false, message: "kredensial Calq tidak tersedia" };
  }

  const items = await sql`
    SELECT procedure_id, procedure_name, unit_price, quantity
    FROM booking_items WHERE booking_id = ${bookingId}`;
  const procedureIds = [...new Set(items.map((i) => Number(i.procedure_id)))];
  // postgres.js hands `date` columns back as JS Date objects — normalise to YYYY-MM-DD
  const visitDate = bk.visit_date instanceof Date
    ? bk.visit_date.toISOString().slice(0, 10)
    : String(bk.visit_date).slice(0, 10);

  // ── Step 1: patient must exist (created during the wizard; if it vanished, fail loudly) ──
  const patientId = Number(bk.calq_patient_id);
  if (!patientId) {
    await recordFailure(bookingId, "calq_patient_id kosong — pasien belum dibuat di Calq");
    return { ok: false, message: "pasien belum ada" };
  }

  // ── Step 2: appointment (latch: appointment_id) ──
  let appointmentId = bk.appointment_id as string | null;
  if (!appointmentId) {
    try {
      const appt = await createAppointment(creds, {
        date: visitDate,
        scheduleId: Number(bk.calq_schedule_id),
        specializationId: Number(bk.specialization_id),
        patientId,
        procedureId: procedureIds,
        ...(bk.slot_time ? { expectedStartTime: String(bk.slot_time) } : {}),
      });
      appointmentId = String(appt.id);
      await sql`
        UPDATE booking_emr SET
          appointment_id = ${appointmentId},
          booking_code = ${appt.bookingCode ?? null},
          queue_number = ${appt.queue?.bookedNumber != null ? String(appt.queue.bookedNumber) : null},
          updated_at = now()
        WHERE booking_id = ${bookingId}`;
    } catch (err) {
      await recordFailure(
        bookingId,
        describeCalqError(
          `POST /appointments gagal (jadwal ${bk.calq_schedule_id}, ${visitDate}, tindakan [${procedureIds.join(",")}])`,
          err,
        ),
      );
      return { ok: false, message: "appointment gagal" };
    }
  }

  // ── Step 3: the sale that carries the money (latch: sale_id). API-created appointments
  //     get no pre-visit sale from Calq, so we create it — but first probe for one a crashed
  //     earlier retry may have left behind (never double-invoice). ──
  let saleId = bk.sale_id as string | null;
  if (!saleId) {
    const ourItems = mergedProcedureItems(items);
    let sale = await findExistingSale(
      creds,
      (bk.mrn as string | null) ?? null,
      procedureIds,
    ).catch(() => null);
    if (!sale) {
      // Calq requires a roomId for PROCEDURE items. An API-created appointment usually has
      // none assigned yet, so fall back to the configured default room
      // (app_settings.calq_default_room_id / env CALQ_DEFAULT_ROOM_ID).
      const appt = await getAppointment(creds, appointmentId).catch(() => null);
      const settings = await appSettings().catch(() => ({} as Record<string, string>));
      const defaultRoom = Number(
        settings["calq_default_room_id"] ?? Deno.env.get("CALQ_DEFAULT_ROOM_ID") ?? "",
      ) || null;
      try {
        sale = await createSale(creds, {
          patientId,
          items: ourItems,
          roomId: appt?.roomId ?? defaultRoom,
          ...(bk.medical_personnel_id ? { medicalPersonnelId: Number(bk.medical_personnel_id) } : {}),
          notes: `Reservasi online ${bk.invoice_number} — ${bk.booking_code ?? ""}`.trim(),
        });
      } catch (err) {
        await recordFailure(bookingId, describeCalqError("POST /sales gagal", err));
        return { ok: false, message: "gagal membuat invoice" };
      }
    }
    if (!sale?.id) {
      await recordFailure(bookingId, "POST /sales tidak mengembalikan id invoice");
      return { ok: false, message: "invoice tanpa id" };
    }
    saleId = String(sale.id);
    await sql`
      UPDATE booking_emr SET sale_id = ${saleId}, sale_invoice_number = ${sale.invoiceNumber ?? null}, updated_at = now()
      WHERE booking_id = ${bookingId}`;
  }

  // ── Step 4: verify/repair items, then post the payment (latch: payment_posted_at) ──
  if (!bk.payment_posted_at) {
    let sale: Awaited<ReturnType<typeof getSale>>;
    try {
      sale = await getSale(creds, saleId);
    } catch (err) {
      await recordFailure(bookingId, describeCalqError(`GET /sales/${saleId} gagal`, err));
      return { ok: false, message: "gagal membaca sale" };
    }

    if (isFullyPaid(sale.status)) {
      // Settled elsewhere (kasir). Do not double-pay — latch and finish.
      await sql`
        UPDATE booking_emr SET payment_posted_at = now(), updated_at = now()
        WHERE booking_id = ${bookingId}`;
    } else {
      const saleProcItems = (sale.items ?? []).filter((i) => i.referenceType === "PROCEDURE");
      const saleProcIds = new Set(saleProcItems.map((i) => Number(i.referenceId)));
      const missing = procedureIds.filter((id) => !saleProcIds.has(id));
      if (saleProcItems.length === 0 || missing.length > 0) {
        // PATCH replaces the WHOLE list: keep every non-procedure line Calq put there, and
        // send our complete procedure set.
        const keep = (sale.items ?? [])
          .filter((i) => i.referenceType !== "PROCEDURE")
          .map((i) => ({
            referenceType: i.referenceType,
            referenceId: Number(i.referenceId),
            quantity: Number(i.quantity ?? 1),
            unitPrice: Number(i.unitPrice ?? 0),
          }));
        const ours = mergedProcedureItems(items);
        try {
          await replaceSaleItems(creds, saleId, [...keep, ...ours]);
        } catch (err) {
          await recordFailure(bookingId, describeCalqError(`PATCH /sales/${saleId} gagal`, err));
          return { ok: false, message: "gagal memperbaiki item" };
        }
        sale = await getSale(creds, saleId).catch(() => sale);
      }

      // items-before-payments guard: refuse to pay an invoice with no lines.
      const finalItems = (sale.items ?? []).length;
      if (finalItems === 0) {
        await recordFailure(
          bookingId,
          `Sale ${saleId} tidak punya item — pembayaran ditahan (Rp0-PAID guard)`,
        );
        return { ok: false, message: "sale kosong" };
      }

      try {
        await postSalePayment(creds, saleId, {
          amount: Number(bk.amount_due),
          type: bk.jenis_pembayaran === "DP" ? "DOWN_PAYMENT" : "REGULAR",
          note: String(bk.invoice_number),
          ...(bk.paid_at ? { paidAt: new Date(bk.paid_at as string).toISOString() } : {}),
        });
      } catch (err) {
        await recordFailure(
          bookingId,
          describeCalqError(`POST /sales/${saleId}/payments gagal`, err),
        );
        return { ok: false, message: "gagal posting pembayaran" };
      }
      await sql`
        UPDATE booking_emr SET payment_posted_at = now(), updated_at = now()
        WHERE booking_id = ${bookingId}`;
    }
  }

  await sql`
    UPDATE booking_emr
    SET sync_status = 'REGISTERED', error = NULL, error_at = NULL, updated_at = now()
    WHERE booking_id = ${bookingId}`;

  // ── Step 5: invoice email — best-effort, never fails the sync ──
  await sendInvoiceEmail(bookingId).catch((err) =>
    console.warn(`[emr-sync] ${bookingId} invoice email failed:`, err)
  );

  return { ok: true, message: "tersinkron" };
}

export async function sendInvoiceEmail(bookingId: string, force = false): Promise<{
  sent: boolean;
  message: string;
}> {
  const rows = await sql`
    SELECT b.visit_date, b.slot_time, b.doctor_name, b.specialization_name, b.polyclinic_name,
           p.invoice_number, p.jenis_pembayaran, p.total_amount, p.amount_due,
           e.booking_code, e.queue_number, e.sale_invoice_number,
           bp.nama_lengkap, bp.email
    FROM bookings b
    JOIN booking_payments p ON p.booking_id = b.id
    LEFT JOIN booking_emr e ON e.booking_id = b.id
    LEFT JOIN booking_patients bp ON bp.booking_id = b.id
    WHERE b.id = ${bookingId}`;
  if (rows.length === 0) return { sent: false, message: "booking tidak ditemukan" };
  const bk = rows[0];

  const to = String(bk.email ?? "").trim();
  if (!looksLikeEmail(to)) {
    return { sent: false, message: "pasien tidak punya alamat email" };
  }
  if (!force) {
    const already = await sql`
      SELECT 1 FROM email_log WHERE booking_id = ${bookingId} AND status = 'SENT' LIMIT 1`;
    if (already.length > 0) return { sent: true, message: "sudah pernah dikirim" };
  }
  const creds = loadSmtpCreds();
  if (!creds || !creds.enabled) {
    await sql`
      INSERT INTO email_log (booking_id, to_email, status, error)
      VALUES (${bookingId}, ${to}, 'SKIPPED', 'SMTP nonaktif/belum dikonfigurasi')`;
    return { sent: false, message: "pengiriman email nonaktif" };
  }

  const items = await sql`
    SELECT procedure_name, unit_price, quantity, bundle_id, bundle_name
    FROM booking_items WHERE booking_id = ${bookingId}`;
  const tanggal = new Date(String(bk.visit_date)).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });

  const mail = renderInvoiceEmail({
    nama: String(bk.nama_lengkap ?? "Pasien"),
    invoiceNumber: String(bk.invoice_number),
    saleInvoiceNumber: bk.sale_invoice_number as string | null,
    bookingCode: bk.booking_code as string | null,
    queueNumber: bk.queue_number as string | null,
    poli: (bk.polyclinic_name ?? bk.specialization_name) as string | null,
    dokter: bk.doctor_name as string | null,
    tanggal,
    jam: bk.slot_time as string | null,
    items: groupBookingItemRows(items),
    totalAmount: Number(bk.total_amount),
    jenisPembayaran: bk.jenis_pembayaran === "DP" ? "DP" : "LUNAS",
    paidAmount: Number(bk.amount_due),
  });

  const out = await sendEmail(creds, to, mail.subject, mail.text, mail.html);
  await sql`
    INSERT INTO email_log (booking_id, to_email, status, error)
    VALUES (${bookingId}, ${to}, ${out.sent ? "SENT" : "FAILED"}, ${out.sent ? null : out.message})`;
  return { sent: out.sent, message: out.message };
}
