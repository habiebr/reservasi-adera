// Public, unauthenticated endpoints: published form definitions + Calq browsing for the
// wizard. Everything is filtered server-side by the form's own config — the client is
// untrusted. polis/schedule-days/procedures get a short in-memory cache; slots never do.
import { Hono } from "hono";
import { sql } from "../db.ts";
import {
  getCalqProducts,
  getDoctorDaySlots,
  getDoctorSchedules,
  getMedicalPersonnelPhotos,
  getPolyclinics,
  getProcedures,
  loadCalqCreds,
  procedurePrice,
} from "../calq.ts";
import { isDoctorOpenOnDate } from "@shared/availability.ts";
import { assembleDefinition, bookingConfigForForm } from "../formStore.ts";
import { listBundles, priceBundles } from "../bundles.ts";

export const publicRoutes = new Hono();

const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL = 60_000;

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

export async function publishedForm(slug: string) {
  const rows = await sql`
    SELECT id, slug, title, headline, description, footer_note
    FROM forms WHERE slug = ${slug} AND status = 'published'`;
  return rows[0] ?? null;
}

/** Any non-archived form. The Calq browse endpoints accept drafts so the builder's live
 * preview can render the real wizard; they expose only master data (poli/doctor/procedure
 * lists) that the published forms already expose. Bookings stay published-only. */
export async function formBySlug(slug: string) {
  const rows = await sql`
    SELECT id, slug, title FROM forms WHERE slug = ${slug} AND status != 'archived'`;
  return rows[0] ?? null;
}

publicRoutes.get("/forms/:slug", async (c) => {
  const form = await publishedForm(c.req.param("slug"));
  if (!form) return c.json({ error: "Form tidak ditemukan" }, 404);
  const definition = await assembleDefinition(form.id as string);
  return c.json({
    slug: form.slug,
    title: form.title,
    branding: {
      headline: form.headline,
      description: form.description,
      footerNote: form.footer_note,
    },
    definition,
  });
});

publicRoutes.get("/calq/polis", async (c) => {
  const form = await formBySlug(c.req.query("slug") ?? "");
  if (!form) return c.json({ error: "Form tidak ditemukan" }, 404);
  const creds = await loadCalqCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);
  const cfg = await bookingConfigForForm(form.id as string);
  const allowed = new Set(cfg.allowedSpecializationIds);

  const polis = await cached("polis", () => getPolyclinics(creds));
  const result = polis
    .filter((p) => p.isActive)
    .map((p) => ({
      id: p.id,
      name: p.name,
      specializations: p.specializations
        .filter((s) => allowed.size === 0 || allowed.has(s.id))
        .map((s) => ({
          id: s.id,
          name: s.label || s.name,
          bookingOrderType: s.bookingOrderType,
        })),
    }))
    .filter((p) => p.specializations.length > 0);
  return c.json({ polis: result });
});

publicRoutes.get("/calq/doctors", async (c) => {
  const form = await formBySlug(c.req.query("slug") ?? "");
  if (!form) return c.json({ error: "Form tidak ditemukan" }, 404);
  const specializationId = Number(c.req.query("specializationId"));
  if (!specializationId) return c.json({ error: "specializationId wajib" }, 400);
  const date = c.req.query("date") ?? "";
  const forDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  const creds = await loadCalqCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);

  // Photos come from a second endpoint; a failure there must cost the avatars, not the list.
  // The dated call is a *different view* of the same endpoint: Calq narrows `schedules` to
  // the date's weekday and fills `timeSlots` with that day's availability. It is never
  // cached — it goes stale the moment somebody books. The undated roster stays cached and
  // supplies the weekly practice days the dated view no longer carries.
  const [doctors, photos, dated] = await Promise.all([
    cached(`doctors:${specializationId}`, () => getDoctorSchedules(creds, specializationId)),
    cached(
      `photos:${specializationId}`,
      () => getMedicalPersonnelPhotos(creds, specializationId),
    ).catch(() => ({} as Record<number, string>)),
    forDate ? getDoctorSchedules(creds, specializationId, forDate) : Promise.resolve(null),
  ]);

  // Subtract this app's own live holds, exactly as /calq/slots does, so a doctor whose last
  // slot is sitting in someone else's checkout does not look free.
  const dayOf = new Map((dated ?? []).map((d) => [d.id, d]));
  const heldSlotIds = [
    ...new Set((dated ?? []).flatMap((d) => (d.timeSlots ?? []).map((s) => s.scheduleId))),
  ];
  const held = !forDate || heldSlotIds.length === 0 ? [] : await sql`
    SELECT calq_schedule_id, slot_time FROM bookings
    WHERE calq_schedule_id IN ${sql(heldSlotIds)} AND visit_date = ${forDate}
      AND status IN ('PENDING','CONFIRMED') AND slot_time IS NOT NULL`;
  const heldKeys = new Set(held.map((r) => `${r.calq_schedule_id}|${r.slot_time}`));

  return c.json({
    doctors: doctors
      .filter((d) => d.schedules.length > 0)
      .map((d) => {
        const base = {
          id: d.id,
          name: [d.title, d.firstName, d.lastName].filter(Boolean).join(" ").trim(),
          photoUrl: photos[d.id] ?? null,
          sessionDuration: d.sessionDuration,
          bookingOrderType: d.bookingOrderType,
          practiceDays: [...new Set(d.schedules.map((s) => s.dayOfWeek))].sort(),
          schedules: d.schedules.map((s) => ({
            id: s.id,
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            endTime: s.endTime,
          })),
        };
        if (!forDate) return base;
        const day = dayOf.get(d.id);
        const sessions = day?.schedules ?? [];
        const slots = day?.timeSlots ?? [];
        const open = slots.filter(
          (s) => s.status === "available" && !heldKeys.has(`${s.scheduleId}|${s.startTime}`),
        );
        const exact = d.bookingOrderType === "EXACT_TIME";
        return {
          ...base,
          practicesOnDate: sessions.length > 0 || slots.length > 0,
          slotsLeft: exact ? open.length : null,
          available: isDoctorOpenOnDate(
            { bookingOrderType: d.bookingOrderType, schedules: sessions, timeSlots: slots },
            (id, start) => heldKeys.has(`${id}|${start}`),
          ),
        };
      }),
  });
});

/**
 * Which dates in a window can actually be booked. The calendar needs this to grey out a day
 * whose sessions are all taken, not merely a day nobody practises — Calq answers per date, so
 * this fans out one dated call per candidate day.
 *
 * Two things keep that affordable: days whose weekday nobody in the poli practises are ruled
 * out from the (cached) weekly roster without asking Calq at all, and the remaining calls run
 * a few at a time against a short per-date cache. The wizard treats the result as an
 * enhancement — the calendar renders from the weekly roster first and tightens when this
 * lands — so a slow or failed answer costs accuracy, never a usable page.
 */
publicRoutes.get("/calq/days", async (c) => {
  const form = await formBySlug(c.req.query("slug") ?? "");
  if (!form) return c.json({ error: "Form tidak ditemukan" }, 404);
  const specializationId = Number(c.req.query("specializationId"));
  const from = c.req.query("from") ?? "";
  const days = Math.min(Math.max(Number(c.req.query("days")) || 30, 1), 62);
  const doctorId = Number(c.req.query("doctorId")) || null;
  if (!specializationId || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return c.json({ error: "specializationId dan from wajib" }, 400);
  }
  const creds = await loadCalqCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);

  const roster = await cached(
    `doctors:${specializationId}`,
    () => getDoctorSchedules(creds, specializationId),
  );
  const relevant = doctorId ? roster.filter((d) => d.id === doctorId) : roster;
  const practiceDays = new Set(relevant.flatMap((d) => d.schedules.map((s) => s.dayOfWeek)));

  const dates: string[] = [];
  const start = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    if (practiceDays.has(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10));
  }
  if (dates.length === 0) return c.json({ days: {} });

  // One sweep for every hold in the window beats a query per date.
  const last = dates[dates.length - 1];
  const held = await sql`
    SELECT visit_date, calq_schedule_id, slot_time FROM bookings
    WHERE visit_date BETWEEN ${dates[0]} AND ${last}
      AND status IN ('PENDING','CONFIRMED') AND slot_time IS NOT NULL`;
  const heldKeys = new Set(
    held.map((r) =>
      `${String(r.visit_date).slice(0, 10)}|${r.calq_schedule_id}|${r.slot_time}`
    ),
  );

  const openOn = async (date: string) => {
    const doctors = await cached(
      `day:${specializationId}:${date}`,
      () => getDoctorSchedules(creds, specializationId, date),
    );
    const mine = doctorId ? doctors.filter((d) => d.id === doctorId) : doctors;
    let free = 0;
    for (const d of mine) {
      const open = isDoctorOpenOnDate(
        d,
        (id, start) => heldKeys.has(`${date}|${id}|${start}`),
      );
      if (open) free++;
    }
    return free;
  };

  // A handful at a time: enough to keep the calendar snappy, gentle on Calq.
  const out: Record<string, { available: boolean; doctors: number }> = {};
  const queue = [...dates];
  await Promise.all(
    Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let date = queue.shift(); date; date = queue.shift()) {
        try {
          const free = await openOn(date);
          out[date] = { available: free > 0, doctors: free };
        } catch {
          // One bad date must not blank the calendar: leave it unmarked, weekly roster wins.
        }
      }
    }),
  );
  return c.json({ days: out });
});

publicRoutes.get("/calq/slots", async (c) => {
  const form = await formBySlug(c.req.query("slug") ?? "");
  if (!form) return c.json({ error: "Form tidak ditemukan" }, 404);
  const specializationId = Number(c.req.query("specializationId"));
  const doctorId = Number(c.req.query("doctorId"));
  const date = c.req.query("date") ?? "";
  if (!specializationId || !doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: "specializationId, doctorId, dan date wajib" }, 400);
  }
  const creds = await loadCalqCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);

  const day = await getDoctorDaySlots(creds, specializationId, doctorId, date);
  if (!day) return c.json({ error: "Dokter tidak ditemukan" }, 404);

  // Subtract this app's own live holds (pending checkouts + paid-but-not-yet-synced).
  const scheduleIds = [
    ...new Set([...day.sessions.map((s) => s.id), ...day.timeSlots.map((s) => s.scheduleId)]),
  ];
  const held = scheduleIds.length === 0 ? [] : await sql`
    SELECT calq_schedule_id, slot_time FROM bookings
    WHERE calq_schedule_id IN ${sql(scheduleIds)} AND visit_date = ${date}
      AND status IN ('PENDING','CONFIRMED') AND slot_time IS NOT NULL`;
  const heldKeys = new Set(held.map((r) => `${r.calq_schedule_id}|${r.slot_time}`));

  return c.json({
    bookingOrderType: day.bookingOrderType,
    sessionDuration: day.sessionDuration,
    doctorName: day.doctorName,
    timeSlots: day.timeSlots.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      scheduleId: s.scheduleId,
      available: s.status === "available" && !heldKeys.has(`${s.scheduleId}|${s.startTime}`),
    })),
    sessions: day.sessions.map((s) => ({
      scheduleId: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
    })),
  });
});

publicRoutes.get("/calq/bundles", async (c) => {
  const form = await formBySlug(c.req.query("slug") ?? "");
  if (!form) return c.json({ error: "Form tidak ditemukan" }, 404);
  const creds = await loadCalqCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);
  const cfg = await bookingConfigForForm(form.id as string);

  const bundles = await listBundles({
    activeOnly: true,
    ids: cfg.allowedBundleIds.length > 0 ? cfg.allowedBundleIds : undefined,
  });
  const [procedures, products] = await Promise.all([
    cached("procedures:all", () => getProcedures(creds)),
    cached("products:all", () => getCalqProducts(creds).catch(() => [])),
  ]);
  return c.json({
    dp: { enabled: cfg.dpEnabled, rule: cfg.dpRule, value: cfg.dpValue ?? null },
    bundles: priceBundles(bundles, procedures, products)
      .filter((b) => b.available && b.price > 0)
      .map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        price: b.price,
        isDownPayment: b.isDownPayment,
        downPaymentAmount: b.downPaymentAmount,
        items: b.items.map((i) => ({
          name: i.procedureName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
      })),
  });
});

publicRoutes.get("/calq/procedures", async (c) => {
  const form = await formBySlug(c.req.query("slug") ?? "");
  if (!form) return c.json({ error: "Form tidak ditemukan" }, 404);
  const specializationId = Number(c.req.query("specializationId")) || undefined;
  const creds = await loadCalqCreds();
  if (!creds) return c.json({ error: "EMR belum dikonfigurasi" }, 503);
  const cfg = await bookingConfigForForm(form.id as string);
  const allowed = new Set(cfg.allowedProcedureIds);

  const procedures = await cached(
    `procedures:${specializationId ?? "all"}`,
    () => getProcedures(creds, specializationId),
  );
  return c.json({
    dp: { enabled: cfg.dpEnabled, rule: cfg.dpRule, value: cfg.dpValue ?? null },
    procedures: procedures
      .filter((p) => p.isActive && (allowed.size === 0 || allowed.has(p.id)))
      .map((p) => ({
        id: p.id,
        name: p.name,
        price: procedurePrice(p),
        isDownPayment: Boolean(p.isDownPayment),
        downPaymentAmount: Number(p.downPaymentAmount ?? 0),
      }))
      .filter((p) => p.price > 0),
  });
});
