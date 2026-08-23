// Patient lookup / creation and the money step. The server recomputes every rupiah from
// live Calq data — the client's numbers are display-only.
import { Hono } from "hono";
import { sql } from "../db.ts";
import {
  CalqError,
  createCalqPatient,
  findCalqPatientByMrn,
  findCalqPatientByNik,
  getDoctorDaySlots,
  getProcedures,
  loadCalqCreds,
  procedurePrice,
} from "../calq.ts";
import { createCheckout, fetchOrderStatus, generateInvoiceNumber, loadDokuCreds } from "../doku.ts";
import { bookingConfigForForm } from "../formStore.ts";
import { publishedForm } from "./public.ts";
import {
  canonPhone,
  isValidNik,
  isValidTanggalLahir,
  maskDob,
  maskName,
} from "@shared/identity.ts";
import { amountDue, dpAmount, totalAmount, type PricedItem } from "@shared/pricing.ts";
import { runEmrSync } from "../emrSync.ts";

export const bookingRoutes = new Hono();

// Soft per-IP throttle on the lookup (unauthenticated NIK surface).
const lookupHits = new Map<string, { count: number; at: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const hit = lookupHits.get(ip);
  if (!hit || now - hit.at > 60_000) {
    lookupHits.set(ip, { count: 1, at: now });
    return false;
  }
  hit.count++;
  return hit.count > 20;
}

bookingRoutes.post("/lookup", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "local";
  if (throttled(ip)) return c.json({ error: "Terlalu banyak percobaan, coba lagi sebentar." }, 429);

  const body = await c.req.json().catch(() => ({}));
  const form = await publishedForm(String(body.slug ?? ""));
  if (!form) return c.json({ error: "Form tidak ditemukan" }, 404);
  const creds = await loadCalqCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);

  const nik = String(body.nik ?? "").replace(/\D/g, "");
  const mrn = String(body.mrn ?? "").trim();

  let patient = null;
  if (nik) {
    if (!isValidNik(nik)) return c.json({ error: "NIK harus 16 digit." }, 400);
    patient = await findCalqPatientByNik(creds, nik);
  } else if (mrn) {
    const cfg = await bookingConfigForForm(form.id as string);
    if (!cfg.allowMrn) return c.json({ error: "Pencarian No. RM tidak tersedia." }, 400);
    patient = await findCalqPatientByMrn(creds, mrn);
  } else {
    return c.json({ error: "Isi NIK atau No. RM." }, 400);
  }

  if (!patient) return c.json({ found: false });
  // Masked on purpose: this endpoint is an enumeration surface.
  return c.json({
    found: true,
    calq_patient_id: String(patient.id),
    mrn: patient.medicalRecordNumber,
    masked_name: maskName([patient.firstName, patient.lastName].filter(Boolean).join(" ")),
    masked_dob: maskDob(patient.dateOfBirth),
    has_email: Boolean(patient.email),
  });
});

bookingRoutes.post("/patient", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const form = await publishedForm(String(body.slug ?? ""));
  if (!form) return c.json({ error: "Form tidak ditemukan" }, 404);
  const creds = await loadCalqCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);

  const p = (body.patient ?? {}) as Record<string, string>;
  const nik = String(p.nik ?? "").replace(/\D/g, "");
  const nama = String(p.nama_lengkap ?? "").trim();
  const dob = String(p.tanggal_lahir ?? "");
  const gender = p.jenis_kelamin === "Laki-laki" ? "MALE" : "FEMALE";
  const phone = canonPhone(p.nomor_hp);

  if (!isValidNik(nik)) return c.json({ error: "NIK harus 16 digit." }, 400);
  if (nama.length < 2) return c.json({ error: "Nama wajib diisi." }, 400);
  if (!isValidTanggalLahir(dob)) return c.json({ error: "Tanggal lahir tidak valid." }, 400);
  if (!phone) return c.json({ error: "Nomor HP wajib diisi." }, 400);

  // Never create a duplicate: if the NIK already exists in Calq, reuse it.
  const existing = await findCalqPatientByNik(creds, nik);
  if (existing) {
    return c.json({ calq_patient_id: String(existing.id), mrn: existing.medicalRecordNumber, existing: true });
  }

  const [firstName, ...rest] = nama.split(/\s+/);
  try {
    const created = await createCalqPatient(creds, {
      firstName,
      ...(rest.length > 0 ? { lastName: rest.join(" ") } : {}),
      identityNumber: nik,
      dateOfBirth: dob,
      gender,
      mobilePhone: phone,
      whatsappNumber: phone,
      ...(p.email ? { email: String(p.email).trim() } : {}),
      ...(p.alamat_domisili ? { domicileAddress: String(p.alamat_domisili).trim() } : {}),
    });
    return c.json({ calq_patient_id: String(created.id), mrn: created.medicalRecordNumber, existing: false });
  } catch (err) {
    const msg = err instanceof CalqError ? err.message : "Gagal membuat data pasien.";
    console.error("[booking/patient] create failed:", err);
    return c.json({ error: msg }, 502);
  }
});

bookingRoutes.post("/create", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const form = await publishedForm(String(body.slug ?? ""));
  if (!form) return c.json({ error: "Form tidak ditemukan" }, 404);
  const creds = await loadCalqCreds();
  const doku = await loadDokuCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);
  if (!doku) return c.json({ error: "Pembayaran belum dikonfigurasi" }, 503);
  const cfg = await bookingConfigForForm(form.id as string);

  // ── selection ──
  const specializationId = Number(body.specialization_id);
  const scheduleId = Number(body.calq_schedule_id);
  const visitDate = String(body.visit_date ?? "");
  const slotTime = body.slot_time ? String(body.slot_time) : null;
  const jenis = body.jenis_pembayaran === "DP" ? "DP" : "LUNAS";
  const procedureIds: number[] = Array.isArray(body.procedure_ids)
    ? body.procedure_ids.map(Number).filter(Boolean)
    : [];
  const calqPatientId = String(body.calq_patient_id ?? "");
  const patient = (body.patient ?? {}) as Record<string, string>;
  const nama = String(patient.nama_lengkap ?? "").trim();

  if (!specializationId || !scheduleId || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
    return c.json({ error: "Pilihan jadwal tidak lengkap." }, 400);
  }
  if (procedureIds.length === 0) return c.json({ error: "Pilih minimal satu tindakan." }, 400);
  if (!calqPatientId) return c.json({ error: "Data pasien belum lengkap." }, 400);
  if (!nama) return c.json({ error: "Nama pasien wajib." }, 400);
  if (
    cfg.allowedSpecializationIds.length > 0 &&
    !cfg.allowedSpecializationIds.includes(specializationId)
  ) {
    return c.json({ error: "Poli tidak tersedia pada form ini." }, 400);
  }

  const today = new Date().toISOString().slice(0, 10);
  const maxDate = new Date(Date.now() + cfg.maxDaysAhead * 86_400_000).toISOString().slice(0, 10);
  if (visitDate < today || visitDate > maxDate) {
    return c.json({ error: "Tanggal di luar rentang reservasi." }, 400);
  }

  // required custom fields
  const answers = (body.answers ?? {}) as Record<string, string>;
  for (const f of cfg.customFields) {
    if (f.required && !String(answers[f.id] ?? "").trim()) {
      return c.json({ error: `Isian "${f.label}" wajib diisi.` }, 400);
    }
  }

  // ── server-side pricing from live Calq ──
  const procedures = await getProcedures(creds, specializationId).catch(() => null);
  if (!procedures) return c.json({ error: "Gagal memuat tindakan dari EMR." }, 502);
  const items: PricedItem[] = [];
  for (const id of new Set(procedureIds)) {
    const proc = procedures.find((p) => p.id === id && p.isActive);
    if (!proc) return c.json({ error: "Tindakan tidak tersedia." }, 400);
    if (cfg.allowedProcedureIds.length > 0 && !cfg.allowedProcedureIds.includes(id)) {
      return c.json({ error: "Tindakan tidak tersedia pada form ini." }, 400);
    }
    items.push({
      procedureId: proc.id,
      name: proc.name,
      unitPrice: procedurePrice(proc),
      quantity: 1,
      isDownPayment: Boolean(proc.isDownPayment),
      downPaymentAmount: Number(proc.downPaymentAmount ?? 0),
    });
  }
  const dpCfg = { dpEnabled: cfg.dpEnabled, dpRule: cfg.dpRule, dpValue: cfg.dpValue };
  const total = totalAmount(items);
  const dp = dpAmount(items, dpCfg);
  if (jenis === "DP" && dp === null) return c.json({ error: "DP tidak tersedia untuk pilihan ini." }, 400);
  const due = amountDue(items, dpCfg, jenis);

  // ── live availability re-check against the doctor's day (Calq truth); our own holds
  //     are enforced by the unique index below — this pre-check gives a friendlier error ──
  const doctorId = Number(body.medical_personnel_id);
  if (!doctorId) return c.json({ error: "Dokter belum dipilih." }, 400);
  const day = await getDoctorDaySlots(creds, specializationId, doctorId, visitDate).catch(() => null);
  if (!day) return c.json({ error: "Gagal memeriksa jadwal dokter." }, 502);
  const bookingOrderType = day.bookingOrderType;
  if (slotTime) {
    const slot = day.timeSlots.find((s) => s.startTime === slotTime && s.scheduleId === scheduleId);
    if (!slot || slot.status !== "available") {
      return c.json({ error: "Slot baru saja terisi, silakan pilih jam lain.", code: "SLOT_TAKEN" }, 409);
    }
  } else {
    // QUEUE: the chosen session must be one of the doctor's sessions on this weekday.
    if (!day.sessions.some((s) => s.id === scheduleId)) {
      return c.json({ error: "Sesi praktik tidak sesuai jadwal dokter." }, 400);
    }
  }

  // NIK dedupe: one live booking per patient per doctor-schedule per day.
  const nik = String(patient.nik ?? "").replace(/\D/g, "") || null;
  if (nik) {
    const dupes = await sql`
      SELECT 1 FROM bookings b
      JOIN booking_patients bp ON bp.booking_id = b.id
      WHERE bp.nik = ${nik} AND b.calq_schedule_id = ${scheduleId}
        AND b.visit_date = ${visitDate} AND b.status IN ('PENDING','CONFIRMED')
      LIMIT 1`;
    if (dupes.length > 0) {
      return c.json({ error: "NIK ini sudah memiliki reservasi pada jadwal tersebut." }, 409);
    }
  }

  const invoiceNumber = generateInvoiceNumber();

  // ── insert (one transaction; 23505 on the hold index = raced) ──
  let bookingId: string;
  try {
    bookingId = await sql.begin(async (tx) => {
      const [b] = await tx`
        INSERT INTO bookings (
          form_id, calq_patient_id, is_new_patient,
          polyclinic_id, polyclinic_name, specialization_id, specialization_name,
          medical_personnel_id, doctor_name, calq_schedule_id, visit_date, slot_time,
          booking_order_type
        ) VALUES (
          ${form.id}, ${calqPatientId}, ${Boolean(body.is_new_patient)},
          ${Number(body.polyclinic_id) || null}, ${String(body.polyclinic_name ?? "") || null},
          ${specializationId}, ${String(body.specialization_name ?? "") || null},
          ${Number(body.medical_personnel_id) || null}, ${String(body.doctor_name ?? "") || null},
          ${scheduleId}, ${visitDate}, ${slotTime}, ${bookingOrderType}
        ) RETURNING id`;
      const id = b.id as string;
      await tx`
        INSERT INTO booking_patients (
          booking_id, nik, mrn, nama_lengkap, tanggal_lahir, jenis_kelamin,
          nomor_hp, email, alamat_domisili
        ) VALUES (
          ${id}, ${nik}, ${String(patient.mrn ?? "") || null}, ${nama.toUpperCase()},
          ${patient.tanggal_lahir || null}, ${patient.jenis_kelamin || null},
          ${canonPhone(patient.nomor_hp)}, ${String(patient.email ?? "").trim() || null},
          ${String(patient.alamat_domisili ?? "").trim() || null}
        )`;
      for (const item of items) {
        await tx`
          INSERT INTO booking_items (booking_id, procedure_id, procedure_name, unit_price, quantity)
          VALUES (${id}, ${item.procedureId}, ${item.name}, ${item.unitPrice}, ${item.quantity})`;
      }
      for (const f of cfg.customFields) {
        const value = String(answers[f.id] ?? "").trim();
        if (value) {
          await tx`
            INSERT INTO booking_answers (booking_id, field_id, field_label, value)
            VALUES (${id}, ${f.id}, ${f.label}, ${value})`;
        }
      }
      await tx`
        INSERT INTO booking_payments (
          booking_id, invoice_number, jenis_pembayaran, total_amount, dp_amount, amount_due
        ) VALUES (${id}, ${invoiceNumber}, ${jenis}, ${total}, ${dp}, ${due})`;
      return id;
    });
  } catch (err) {
    if (String(err).includes("bookings_slot_hold")) {
      return c.json({ error: "Slot baru saja terisi, silakan pilih jam lain.", code: "SLOT_TAKEN" }, 409);
    }
    console.error("[booking/create] insert failed:", err);
    return c.json({ error: "Terjadi kesalahan, silakan coba lagi." }, 500);
  }

  // ── DOKU checkout. On refusal the booking must not hold the slot: capture → delete. ──
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
  const result = await createCheckout(doku, {
    invoiceNumber,
    amount: due,
    customer: { name: nama, email: patient.email, phone: canonPhone(patient.nomor_hp) },
    callbackUrl: `${appUrl}/${form.slug}/status?invoice=${invoiceNumber}`,
    notificationUrl: `${appUrl}/api/webhooks/doku`,
  });

  if (!result.ok) {
    console.error(
      `[booking/create] DOKU refused ${invoiceNumber}: status=${result.httpStatus} ${result.errorMessage}`,
    );
    await sql`
      INSERT INTO booking_failures (
        invoice_number, form_slug, payload, stage, http_status, error_code, error_message, gateway_response
      ) VALUES (
        ${invoiceNumber}, ${form.slug},
        ${
      sql.json(JSON.parse(JSON.stringify({
        selection: { specializationId, scheduleId, visitDate, slotTime },
        patient,
        items,
        jenis,
        total,
        dp,
        due,
      })))
    },
        'doku_create', ${result.httpStatus}, ${result.errorCode},
        ${result.errorMessage.slice(0, 500)}, ${result.raw ? sql.json(JSON.parse(JSON.stringify(result.raw))) : null}
      )`;
    await sql`DELETE FROM bookings WHERE id = ${bookingId}`;
    return c.json({
      error: "Layanan pembayaran sedang gangguan. Tim kami akan menghubungi Anda.",
      reference: invoiceNumber,
    }, 502);
  }

  await sql`
    UPDATE booking_payments SET payment_url = ${result.paymentUrl}
    WHERE invoice_number = ${invoiceNumber}`;

  return c.json({ payment_url: result.paymentUrl, invoice_number: invoiceNumber, amount: due });
});

bookingRoutes.get("/status", async (c) => {
  const invoice = c.req.query("invoice") ?? "";
  if (!invoice) return c.json({ error: "invoice wajib" }, 400);
  const rows = await sql`
    SELECT b.id, b.status AS booking_status, b.visit_date, b.slot_time, b.booking_order_type,
           b.doctor_name, b.specialization_name, b.polyclinic_name,
           p.invoice_number, p.jenis_pembayaran, p.total_amount, p.dp_amount, p.amount_due,
           p.status AS payment_status, p.paid_at, p.payment_url,
           e.booking_code, e.queue_number, e.sync_status,
           bp.nama_lengkap, bp.email
    FROM booking_payments p
    JOIN bookings b ON b.id = p.booking_id
    LEFT JOIN booking_emr e ON e.booking_id = b.id
    LEFT JOIN booking_patients bp ON bp.booking_id = b.id
    WHERE p.invoice_number = ${invoice}`;
  if (rows.length === 0) return c.json({ error: "Tidak ditemukan" }, 404);
  const row = rows[0];

  // A lost webhook must not strand the patient: poll DOKU inline while pending.
  if (row.payment_status === "PENDING") {
    const doku = await loadDokuCreds();
    if (doku) {
      const remote = await fetchOrderStatus(doku, invoice);
      const s = (remote?.status ?? "").toUpperCase();
      if (s === "SUCCESS" || s === "PAID") {
        await markPaidAndSync(invoice);
        row.payment_status = "PAID";
      } else if (s === "EXPIRED" || s === "FAILED") {
        await markExpired(invoice);
        row.payment_status = "EXPIRED";
        row.booking_status = "CANCELLED";
      }
    }
  }

  const items = await sql`
    SELECT procedure_name, unit_price, quantity FROM booking_items WHERE booking_id = ${row.id}`;

  return c.json({
    booking_status: row.booking_status,
    payment_status: row.payment_status,
    payment_url: row.payment_url,
    invoice_number: row.invoice_number,
    jenis_pembayaran: row.jenis_pembayaran,
    total_amount: row.total_amount,
    dp_amount: row.dp_amount,
    amount_due: row.amount_due,
    paid_at: row.paid_at,
    visit_date: row.visit_date,
    slot_time: row.slot_time,
    booking_order_type: row.booking_order_type,
    doctor_name: row.doctor_name,
    specialization_name: row.specialization_name,
    polyclinic_name: row.polyclinic_name,
    nama_lengkap: row.nama_lengkap,
    email_masked: row.email ? String(row.email).replace(/(.{2}).+(@.+)/, "$1***$2") : null,
    booking_code: row.booking_code,
    queue_number: row.queue_number,
    emr_ok: row.sync_status === "REGISTERED",
    items: items.map((i) => ({
      name: i.procedure_name,
      unitPrice: Number(i.unit_price),
      quantity: Number(i.quantity),
    })),
  });
});

/** Shared by the webhook and the inline status poll. Idempotent single-row flip. */
export async function markPaidAndSync(invoiceNumber: string): Promise<void> {
  const updated = await sql`
    UPDATE booking_payments SET status = 'PAID', paid_at = now()
    WHERE invoice_number = ${invoiceNumber} AND status = 'PENDING'
    RETURNING booking_id`;
  if (updated.length === 0) return; // already handled (webhook retry / double poll)
  const bookingId = updated[0].booking_id as string;
  await sql`UPDATE bookings SET status = 'CONFIRMED', updated_at = now() WHERE id = ${bookingId}`;
  await sql`
    INSERT INTO booking_emr (booking_id, sync_status) VALUES (${bookingId}, 'PENDING')
    ON CONFLICT (booking_id) DO NOTHING`;
  // fire-and-forget with its own error capture — the webhook response must not wait on Calq
  runEmrSync(bookingId).catch((err) => console.error(`[emr-sync] ${bookingId} crashed:`, err));
}

export async function markExpired(invoiceNumber: string): Promise<void> {
  const updated = await sql`
    UPDATE booking_payments SET status = 'EXPIRED'
    WHERE invoice_number = ${invoiceNumber} AND status = 'PENDING'
    RETURNING booking_id`;
  if (updated.length === 0) return;
  // frees the slot-hold index
  await sql`
    UPDATE bookings SET status = 'CANCELLED', updated_at = now()
    WHERE id = ${updated[0].booking_id}`;
}
