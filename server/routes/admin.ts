// Admin API. Everything except login/logout sits behind the JWT-cookie middleware.
import { Hono } from "hono";
import { sql, appSettings, setAppSetting } from "../db.ts";
import { login, logout, requireAdmin, type AdminClaims } from "../auth.ts";
import {
  getDoctorSchedules,
  getPolyclinics,
  getProcedures,
  loadCalqCreds,
  procedurePrice,
} from "../calq.ts";
import { assembleDefinition, saveDefinition } from "../formStore.ts";
import { defaultDefinition, validateDefinition, type FormDefinition } from "@shared/formTypes.ts";
import { runEmrSync, sendInvoiceEmail } from "../emrSync.ts";
import { listBundles, parseBundleInput, priceBundles, saveBundle } from "../bundles.ts";

export const adminRoutes = new Hono<{ Variables: { admin: AdminClaims } }>();

adminRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const claims = await login(c, String(body.email ?? ""), String(body.password ?? ""));
  if (!claims) return c.json({ error: "Email atau kata sandi salah." }, 401);
  return c.json({ email: claims.email, name: claims.name });
});

adminRoutes.post("/logout", (c) => {
  logout(c);
  return c.json({ ok: true });
});

adminRoutes.use("*", requireAdmin);

adminRoutes.get("/me", (c) => {
  const admin = c.get("admin");
  return c.json({ email: admin.email, name: admin.name });
});

// ── Forms ──

const SLUG_RE = /^[a-z0-9-]{3,60}$/;
const slugify = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

adminRoutes.get("/forms", async (c) => {
  const forms = await sql`
    SELECT f.id, f.slug, f.title, f.status, f.updated_at,
           (SELECT count(*) FROM bookings b WHERE b.form_id = f.id) AS booking_count
    FROM forms f
    WHERE f.status != 'archived'
    ORDER BY f.updated_at DESC`;
  return c.json({ forms });
});

adminRoutes.post("/forms", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  const slug = SLUG_RE.test(String(body.slug ?? "")) ? String(body.slug) : slugify(title);
  if (!title) return c.json({ error: "Judul wajib diisi." }, 400);
  if (!SLUG_RE.test(slug)) return c.json({ error: "Slug tidak valid (a-z, 0-9, tanda hubung)." }, 400);

  const exists = await sql`SELECT 1 FROM forms WHERE slug = ${slug}`;
  if (exists.length > 0) return c.json({ error: "Slug sudah dipakai." }, 409);

  const [form] = await sql`
    INSERT INTO forms (slug, title, created_by)
    VALUES (${slug}, ${title}, ${c.get("admin").email})
    RETURNING id`;
  await saveDefinition(form.id as string, defaultDefinition(() => crypto.randomUUID()));
  return c.json({ id: form.id, slug });
});

adminRoutes.get("/forms/:id", async (c) => {
  const rows = await sql`SELECT * FROM forms WHERE id = ${c.req.param("id")}`;
  if (rows.length === 0) return c.json({ error: "Tidak ditemukan" }, 404);
  const form = rows[0];
  const definition = await assembleDefinition(form.id as string);
  return c.json({
    id: form.id,
    slug: form.slug,
    title: form.title,
    status: form.status,
    branding: {
      headline: form.headline,
      description: form.description,
      footerNote: form.footer_note,
    },
    definition,
    problems: validateDefinition(definition),
  });
});

adminRoutes.put("/forms/:id", async (c) => {
  const id = c.req.param("id");
  const rows = await sql`SELECT status FROM forms WHERE id = ${id}`;
  if (rows.length === 0) return c.json({ error: "Tidak ditemukan" }, 404);
  const body = await c.req.json().catch(() => ({}));

  const definition = body.definition as FormDefinition | undefined;
  const problems = definition ? validateDefinition(definition) : [];
  // A published form must stay valid at all times; drafts may save with warnings.
  if (rows[0].status === "published" && problems.length > 0) {
    return c.json({ error: "Form terbit tidak boleh disimpan dalam keadaan tidak valid.", problems }, 422);
  }

  if (body.title !== undefined || body.branding !== undefined) {
    const branding = (body.branding ?? {}) as Record<string, string>;
    await sql`
      UPDATE forms SET
        title = COALESCE(${body.title !== undefined ? String(body.title) : null}, title),
        headline = ${branding.headline ?? null},
        description = ${branding.description ?? null},
        footer_note = ${branding.footerNote ?? null},
        updated_at = now()
      WHERE id = ${id}`;
  }
  if (definition) await saveDefinition(id, definition);
  return c.json({ ok: true, problems });
});

adminRoutes.post("/forms/:id/publish", async (c) => {
  const id = c.req.param("id");
  const definition = await assembleDefinition(id);
  const problems = validateDefinition(definition);
  if (problems.length > 0) return c.json({ error: "Form belum valid.", problems }, 422);
  await sql`UPDATE forms SET status = 'published', updated_at = now() WHERE id = ${id}`;
  return c.json({ ok: true });
});

adminRoutes.post("/forms/:id/unpublish", async (c) => {
  await sql`
    UPDATE forms SET status = 'draft', updated_at = now() WHERE id = ${c.req.param("id")}`;
  return c.json({ ok: true });
});

adminRoutes.post("/forms/:id/duplicate", async (c) => {
  const id = c.req.param("id");
  const rows = await sql`SELECT slug, title FROM forms WHERE id = ${id}`;
  if (rows.length === 0) return c.json({ error: "Tidak ditemukan" }, 404);
  const definition = await assembleDefinition(id);
  // regenerate every id so the copy is fully detached
  const cloned: FormDefinition = {
    schemaVersion: 1,
    pages: definition.pages.map((p) => ({
      ...p,
      id: crypto.randomUUID(),
      blocks: p.blocks.map((b) => ({
        ...b,
        id: crypto.randomUUID(),
        config: {
          ...b.config,
          customFields: (b.config.customFields ?? []).map((f) => ({
            ...f,
            id: crypto.randomUUID(),
          })),
        },
      })),
    })),
  };
  let slug = `${rows[0].slug}-copy`;
  for (let i = 2; (await sql`SELECT 1 FROM forms WHERE slug = ${slug}`).length > 0; i++) {
    slug = `${rows[0].slug}-copy-${i}`;
  }
  const [copy] = await sql`
    INSERT INTO forms (slug, title, created_by)
    VALUES (${slug}, ${rows[0].title + " (salinan)"}, ${c.get("admin").email})
    RETURNING id`;
  await saveDefinition(copy.id as string, cloned);
  return c.json({ id: copy.id, slug });
});

adminRoutes.delete("/forms/:id", async (c) => {
  const id = c.req.param("id");
  const rows = await sql`SELECT status FROM forms WHERE id = ${id}`;
  if (rows.length === 0) return c.json({ error: "Tidak ditemukan" }, 404);
  if (rows[0].status === "published") {
    return c.json({ error: "Tarik form dari publikasi dulu sebelum menghapus." }, 400);
  }
  const used = await sql`SELECT 1 FROM bookings WHERE form_id = ${id} LIMIT 1`;
  if (used.length > 0) {
    await sql`UPDATE forms SET status = 'archived', updated_at = now() WHERE id = ${id}`;
    return c.json({ ok: true, archived: true });
  }
  await sql`DELETE FROM forms WHERE id = ${id}`;
  return c.json({ ok: true });
});

// ── Paket (bundles) ──

adminRoutes.get("/bundles", async (c) => {
  const bundles = await listBundles();
  const creds = await loadCalqCreds();
  // Calq down → serve the catalog without prices; the UI shows a warning instead of locking up.
  const procedures = creds ? await getProcedures(creds).catch(() => null) : null;
  return c.json({
    priced: procedures !== null,
    bundles: procedures ? priceBundles(bundles, procedures) : bundles,
  });
});

adminRoutes.post("/bundles", async (c) => {
  const input = parseBundleInput(await c.req.json().catch(() => ({})));
  if (typeof input === "string") return c.json({ error: input }, 400);
  const id = await saveBundle(input);
  return c.json({ id });
});

adminRoutes.put("/bundles/:id", async (c) => {
  const input = parseBundleInput(await c.req.json().catch(() => ({})));
  if (typeof input === "string") return c.json({ error: input }, 400);
  try {
    await saveBundle(input, c.req.param("id"));
  } catch {
    return c.json({ error: "Paket tidak ditemukan." }, 404);
  }
  return c.json({ ok: true });
});

adminRoutes.delete("/bundles/:id", async (c) => {
  const id = c.req.param("id");
  // Past bookings keep their bundle_name snapshot; form allow-lists cascade off.
  const gone = await sql`DELETE FROM bundles WHERE id = ${id} RETURNING id`;
  if (gone.length === 0) return c.json({ error: "Paket tidak ditemukan." }, 404);
  return c.json({ ok: true });
});

// ── Bookings ──

adminRoutes.get("/bookings", async (c) => {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const pageSize = 25;
  const status = c.req.query("status") ?? "";
  const formId = c.req.query("form_id") ?? "";

  const where = sql`
    WHERE (${status} = '' OR b.status = ${status})
      AND (${formId} = '' OR b.form_id = ${formId}::uuid)`;
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM bookings b ${where}`;
  const rows = await sql`
    SELECT b.id, b.status, b.visit_date, b.slot_time, b.booking_order_type,
           b.specialization_name, b.doctor_name, b.created_at,
           f.slug AS form_slug,
           bp.nama_lengkap, bp.nik, bp.nomor_hp, bp.email,
           p.invoice_number, p.jenis_pembayaran, p.total_amount, p.amount_due,
           p.status AS payment_status, p.paid_at,
           e.sync_status, e.error AS emr_error, e.booking_code, e.queue_number
    FROM bookings b
    LEFT JOIN forms f ON f.id = b.form_id
    LEFT JOIN booking_patients bp ON bp.booking_id = b.id
    LEFT JOIN booking_payments p ON p.booking_id = b.id
    LEFT JOIN booking_emr e ON e.booking_id = b.id
    ${where}
    ORDER BY b.created_at DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  return c.json({ bookings: rows, total: count, page, pageSize });
});

adminRoutes.post("/bookings/:id/retry-emr", async (c) => {
  const result = await runEmrSync(c.req.param("id"));
  return c.json(result, result.ok ? 200 : 502);
});

adminRoutes.post("/bookings/:id/resend-email", async (c) => {
  const result = await sendInvoiceEmail(c.req.param("id"), true);
  return c.json(result, result.sent ? 200 : 502);
});

adminRoutes.get("/failures", async (c) => {
  const rows = await sql`
    SELECT * FROM booking_failures ORDER BY resolved ASC, created_at DESC LIMIT 200`;
  return c.json({ failures: rows });
});

adminRoutes.post("/failures/:id/resolve", async (c) => {
  await sql`
    UPDATE booking_failures
    SET resolved = true, resolved_by = ${c.get("admin").email}, resolved_at = now()
    WHERE id = ${c.req.param("id")}`;
  return c.json({ ok: true });
});

// ── Calq browse (builder config pickers + read-only Dokter & Jadwal tab) ──

adminRoutes.get("/calq/polis", async (c) => {
  const creds = await loadCalqCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);
  const polis = await getPolyclinics(creds);
  return c.json({
    env: creds.isSandbox ? "sandbox" : "production",
    polis: polis.filter((p) => p.isActive).map((p) => ({
      id: p.id,
      name: p.name,
      specializations: p.specializations.map((s) => ({
        id: s.id,
        name: s.label || s.name,
        bookingOrderType: s.bookingOrderType,
      })),
    })),
  });
});

adminRoutes.get("/calq/doctors", async (c) => {
  const creds = await loadCalqCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);
  const specializationId = Number(c.req.query("specializationId"));
  if (!specializationId) return c.json({ error: "specializationId wajib" }, 400);
  const doctors = await getDoctorSchedules(creds, specializationId);
  return c.json({
    doctors: doctors.map((d) => ({
      id: d.id,
      name: [d.title, d.firstName, d.lastName].filter(Boolean).join(" ").trim(),
      sessionDuration: d.sessionDuration,
      bookingOrderType: d.bookingOrderType,
      schedules: d.schedules.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    })),
  });
});

adminRoutes.get("/calq/procedures", async (c) => {
  const creds = await loadCalqCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);
  const specializationId = Number(c.req.query("specializationId")) || undefined;
  const procedures = await getProcedures(creds, specializationId);
  return c.json({
    procedures: procedures
      .filter((p) => p.isActive)
      .map((p) => ({
        id: p.id,
        name: p.name,
        price: procedurePrice(p),
        specializationId: p.specializationId,
        isDownPayment: Boolean(p.isDownPayment),
        downPaymentAmount: Number(p.downPaymentAmount ?? 0),
      })),
  });
});

// ── Settings ──

adminRoutes.get("/settings", async (c) => {
  const settings = await appSettings();
  return c.json({
    settings,
    env: {
      calq_env_default: Deno.env.get("CALQ_ENV") ?? "sandbox",
      doku_env_default: Deno.env.get("DOKU_ENV") ?? "sandbox",
      smtp_enabled: (Deno.env.get("SMTP_ENABLED") ?? "").toLowerCase() === "true",
    },
  });
});

const SETTABLE = new Set(["calq_env", "doku_env"]);
adminRoutes.put("/settings/:key", async (c) => {
  const key = c.req.param("key");
  if (!SETTABLE.has(key)) return c.json({ error: "Kunci tidak dikenal." }, 400);
  const body = await c.req.json().catch(() => ({}));
  const value = String(body.value ?? "");
  if (!["sandbox", "production"].includes(value)) {
    return c.json({ error: "Nilai harus sandbox atau production." }, 400);
  }
  await setAppSetting(key, value);
  return c.json({ ok: true });
});
