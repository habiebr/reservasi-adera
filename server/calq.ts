// Calq EMR client. Ported from vaksinadera's _shared/calq.ts and extended with the
// appointment-system endpoints this app is built on. All facts here were verified against
// the live sandbox (see docs/ARCHITECTURE.md): the swagger DTO for POST /appointments is
// misleading — the shapes below are the authoritative, probe-confirmed ones.
import { appSettings } from "./db.ts";

export interface CalqCreds {
  baseUrl: string;
  apiKey: string;
  isSandbox: boolean;
  paymentMethodId: string;
}

export async function loadCalqCreds(): Promise<CalqCreds | null> {
  const settings = await appSettings().catch(() => ({} as Record<string, string>));
  const env = (settings["calq_env"] ?? Deno.env.get("CALQ_ENV") ?? "sandbox").toLowerCase();
  const isSandbox = env !== "production";
  const suffix = isSandbox ? "SANDBOX" : "PRODUCTION";
  const baseUrl = Deno.env.get(`CALQ_BASE_URL_${suffix}`) ?? "";
  const apiKey = Deno.env.get(`CALQ_API_KEY_${suffix}`) ?? "";
  const paymentMethodId = Deno.env.get(`CALQ_PAYMENT_METHOD_ID_${suffix}`) ??
    (isSandbox ? "14" : "3");
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, isSandbox, paymentMethodId };
}

export class CalqError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
  }
}

async function calqFetch(
  creds: CalqCreds,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 20_000,
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${creds.baseUrl}${path}`, {
      method,
      headers: {
        "X-API-KEY": creds.apiKey,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const msg = (parsed as { message?: string })?.message ?? `Calq ${res.status}`;
      throw new CalqError(res.status, parsed, msg);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/** GET returning `data` (Calq wraps everything in {status, data, message}). */
export async function calqGet(creds: CalqCreds, path: string): Promise<unknown> {
  const r = await calqFetch(creds, "GET", path);
  return (r as { data?: unknown })?.data ?? r;
}

export async function calqPost(creds: CalqCreds, path: string, body: unknown): Promise<unknown> {
  const r = await calqFetch(creds, "POST", path, body);
  return (r as { data?: unknown })?.data ?? r;
}

export async function calqPatch(creds: CalqCreds, path: string, body: unknown): Promise<unknown> {
  const r = await calqFetch(creds, "PATCH", path, body);
  return (r as { data?: unknown })?.data ?? r;
}

// ── Patients ──

export interface CalqPatient {
  id: number;
  identityNumber: string | null;
  medicalRecordNumber: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  mobilePhone?: string | null;
  whatsappNumber?: string | null;
  email?: string | null;
  domicileAddress?: string | null;
}

const digitsOnly = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Exact-NIK match: a fuzzy /patients?search hit that isn't the exact NIK resolves to null. */
export async function findCalqPatientByNik(
  creds: CalqCreds,
  nik: string,
): Promise<CalqPatient | null> {
  const data = await calqGet(creds, `/patients?search=${encodeURIComponent(nik)}`).catch(() => null);
  const list = Array.isArray(data) ? data : [];
  return (list as CalqPatient[]).find((p) => digitsOnly(p.identityNumber) === nik) ?? null;
}

export async function findCalqPatientByMrn(
  creds: CalqCreds,
  mrn: string,
): Promise<CalqPatient | null> {
  const wanted = mrn.trim().toUpperCase();
  const data = await calqGet(creds, `/patients?search=${encodeURIComponent(wanted)}`).catch(() =>
    null
  );
  const list = Array.isArray(data) ? data : [];
  return (list as CalqPatient[]).find(
    (p) => (p.medicalRecordNumber ?? "").trim().toUpperCase() === wanted,
  ) ?? null;
}

export interface NewCalqPatient {
  firstName: string;
  lastName?: string;
  identityNumber: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: "MALE" | "FEMALE";
  mobilePhone?: string;
  whatsappNumber?: string;
  email?: string;
  domicileAddress?: string;
}

/** POST /patients — verified: returns {id, medicalRecordNumber, …}, id immediately usable. */
export async function createCalqPatient(
  creds: CalqCreds,
  patient: NewCalqPatient,
): Promise<CalqPatient> {
  const created = await calqPost(creds, "/patients", { identityType: "KTP", ...patient });
  return created as CalqPatient;
}

// ── Browse: poli / doctors / slots / procedures ──

export interface CalqSpecialization {
  id: number;
  name: string;
  label: string | null;
  bookingOrderType: string; // QUEUE | EXACT_TIME
  polyclinicId: number;
  branchId: number;
}

export interface CalqPolyclinic {
  id: number;
  name: string;
  code: string;
  isActive: boolean;
  specializations: CalqSpecialization[];
}

export function getPolyclinics(creds: CalqCreds): Promise<CalqPolyclinic[]> {
  return calqGet(creds, "/polyclinic") as Promise<CalqPolyclinic[]>;
}

export interface CalqDoctorSchedule {
  id: number;
  medicalPersonnelId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timeZone: string;
  roomId: number | null;
  branchId: number;
}

export interface CalqTimeSlot {
  startTime: string;
  endTime: string;
  scheduleId: number;
  bookingCode: string | null;
  status: string; // "available" | booked
}

export interface CalqDoctorWithSchedules {
  id: number;
  firstName: string;
  lastName: string | null;
  title: string | null;
  sessionDuration: number;
  bookingOrderType: string;
  specializations: { id: number; name: string }[];
  schedules: CalqDoctorSchedule[];
  timeSlots: CalqTimeSlot[];
}

/**
 * Doctor portraits keyed by medical-personnel id. They live on /medical-personnels, not on
 * /medical-personnels/schedules, so this is its own call. Calq hands them out as short-lived
 * signed GCS links (X-Goog-Expires=3600) — fine to pass straight to the browser behind the
 * 60s response cache, but never worth storing.
 */
export async function getMedicalPersonnelPhotos(
  creds: CalqCreds,
  specializationId: number,
): Promise<Record<number, string>> {
  const data = await calqGet(
    creds,
    `/medical-personnels?specializationId=${specializationId}`,
  );
  const list = Array.isArray(data) ? data as { id: number; photo?: unknown }[] : [];
  const out: Record<number, string> = {};
  for (const d of list) {
    const url = extractPhotoUrl(d.photo);
    if (url) out[d.id] = url;
  }
  return out;
}

/**
 * `photo` is null for all 31 doctors in the sandbox, so its populated shape is unverified —
 * production is the only place it carries data. Accept a bare URL string or the usual object
 * spellings and ignore anything else, so an unexpected shape costs an avatar, not the page.
 */
function extractPhotoUrl(photo: unknown): string | null {
  if (typeof photo === "string") return photo.startsWith("http") ? photo : null;
  if (photo && typeof photo === "object") {
    for (const k of ["url", "signedUrl", "publicUrl", "fileUrl", "src", "path"]) {
      const v = (photo as Record<string, unknown>)[k];
      if (typeof v === "string" && v.startsWith("http")) return v;
    }
  }
  return null;
}

export function getDoctorSchedules(
  creds: CalqCreds,
  specializationId: number,
  date?: string,
): Promise<CalqDoctorWithSchedules[]> {
  const qs = new URLSearchParams({ specializationId: String(specializationId) });
  if (date) qs.set("date", date);
  return calqGet(creds, `/medical-personnels/schedules?${qs}`) as Promise<
    CalqDoctorWithSchedules[]
  >;
}

export interface DoctorDaySlots {
  bookingOrderType: string;
  sessionDuration: number;
  doctorName: string;
  /** EXACT_TIME: the day's slots (each carries its scheduleId, status "available" or booked). */
  timeSlots: CalqTimeSlot[];
  /** The doctor's practice sessions that fall on this date's weekday. */
  sessions: CalqDoctorSchedule[];
}

/**
 * Availability for one doctor on one date. Calq's /appointments/available-time-slots is NOT
 * used: probed live, it reports bookingOrderType QUEUE with empty timeSlots even for an
 * EXACT_TIME doctor — /medical-personnels/schedules?date= is the endpoint that actually
 * computes per-slot availability (verified in docs/ARCHITECTURE.md).
 */
export async function getDoctorDaySlots(
  creds: CalqCreds,
  specializationId: number,
  medicalPersonnelId: number,
  date: string,
): Promise<DoctorDaySlots | null> {
  const doctors = await getDoctorSchedules(creds, specializationId, date);
  const doc = doctors.find((d) => d.id === medicalPersonnelId);
  if (!doc) return null;
  // Calq's dayOfWeek matches JS getDay (Sun=0). The date is a plain civil date; parsing at
  // noon UTC gives its weekday without timezone drift.
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return {
    bookingOrderType: doc.bookingOrderType,
    sessionDuration: doc.sessionDuration,
    doctorName: [doc.title, doc.firstName, doc.lastName].filter(Boolean).join(" ").trim(),
    timeSlots: doc.timeSlots ?? [],
    sessions: (doc.schedules ?? []).filter((s) => s.dayOfWeek === dow),
  };
}

export interface CalqProcedure {
  id: number;
  name: string;
  price: string | number;
  specialPrice: string | number;
  isDownPayment: boolean;
  downPaymentAmount: string | number;
  isActive: boolean;
  category: string | null;
  specializationId: number;
}

export function getProcedures(
  creds: CalqCreds,
  specializationId?: number,
  medicalPersonnelId?: number,
): Promise<CalqProcedure[]> {
  const qs = new URLSearchParams();
  if (specializationId) qs.set("specializationId", String(specializationId));
  if (medicalPersonnelId) qs.set("medicalPersonnelId", String(medicalPersonnelId));
  const suffix = qs.size ? `?${qs}` : "";
  return calqGet(creds, `/procedure${suffix}`) as Promise<CalqProcedure[]>;
}

/** The price Calq actually charges for a procedure. */
export function procedurePrice(p: CalqProcedure): number {
  const special = Number(p.specialPrice ?? 0);
  const base = Number(p.price ?? 0);
  return special > 0 ? special : base;
}

// ── Master-data browse (admin "Data Calq" tab; all read-only) ──

export interface CalqProduct {
  id: number;
  name: string;
  type: string | null; // PRODUCT | MEDICINE | …
  genericName: string | null;
  manufacturer: string | null;
  sku: string | null;
  form: string | null;
  dosage: string | null;
  dosageUnit: string | null;
  sellingPrice: string | number | null;
  specialPrice: string | number | null;
  deletedAt: string | null;
}

/** GET /products — the pharmacy/product catalog (obat, vaksin stok, dsb). */
export function getCalqProducts(creds: CalqCreds): Promise<CalqProduct[]> {
  return calqGet(creds, "/products?limit=1000") as Promise<CalqProduct[]>;
}

export interface CalqPaymentMethod {
  id: number;
  name: string;
  type: string | null;
  category: string | null;
  isActive: boolean;
}

export function getCalqPaymentMethods(creds: CalqCreds): Promise<CalqPaymentMethod[]> {
  return calqGet(creds, "/payment-methods") as Promise<CalqPaymentMethod[]>;
}

export interface CalqRoom {
  id: number;
  name: string;
  isActive: boolean;
}

export function getCalqRooms(creds: CalqCreds): Promise<CalqRoom[]> {
  return calqGet(creds, "/rooms") as Promise<CalqRoom[]>;
}

export interface CalqVaccine {
  id: number;
  name: string;
  type: string | null;
  frequency: number | null;
  ageRange: string | null;
  description: string | null;
  procedureId: number | null;
}

export function getCalqVaccines(creds: CalqCreds): Promise<CalqVaccine[]> {
  return calqGet(creds, "/vaccine") as Promise<CalqVaccine[]>;
}

// ── Appointments & sales ──

export interface CalqAppointment {
  id: number;
  patientId: number;
  date: string;
  scheduleId: number;
  specializationId: number;
  bookingCode: string | null;
  paymentStatus: string | null;
  queue?: { bookedNumber: number; status: string } | null;
}

/**
 * POST /appointments (probe-confirmed shape). Creating an appointment also auto-creates its
 * sale/invoice in Calq with the PROCEDURE line items — resolve it with findSaleForAppointment.
 */
export function getAppointment(
  creds: CalqCreds,
  id: number | string,
): Promise<CalqAppointment & { roomId?: number | null }> {
  return calqGet(creds, `/appointments/${id}`) as Promise<
    CalqAppointment & { roomId?: number | null }
  >;
}

export function createAppointment(
  creds: CalqCreds,
  input: {
    date: string;
    scheduleId: number;
    specializationId: number;
    patientId: number;
    procedureId: number[];
    expectedStartTime?: string;
  },
): Promise<CalqAppointment> {
  return calqPost(creds, "/appointments", {
    type: "OFFLINE",
    hasAcceptedPrivacyPolicy: true,
    ...input,
  }) as Promise<CalqAppointment>;
}

export interface CalqSaleItem {
  id?: number;
  referenceType: string;
  referenceId: number;
  quantity: number;
  unitPrice: string | number;
}

export interface CalqSale {
  id: number;
  invoiceNumber: string;
  status: string; // DRAFT | FINALIZED | PAID | …
  total: string | number;
  date: string;
  items?: CalqSaleItem[];
  payments?: { amount?: string | number; nominal?: string | number; paidAt?: string }[];
}

export function isFullyPaid(status: string | null | undefined): boolean {
  // A PAID sale is settled — never patch its items or post another payment onto it.
  return (status ?? "").toUpperCase() === "PAID";
}

/**
 * Create the sale that carries this booking's money. Probed live: an API-created OFFLINE
 * appointment does NOT auto-create a sale before the visit (the sales seen on completed
 * appointments are made at consult/checkout), and GET /sales?patientId= is IGNORED by Calq
 * (returns everyone) — so we create our own sale and hold its id, no matching heuristics.
 */
export async function createSale(
  creds: CalqCreds,
  input: {
    patientId: number;
    items: CalqSaleItem[];
    roomId?: number | null; // required by Calq for PROCEDURE items
    medicalPersonnelId?: number;
    notes?: string;
  },
): Promise<CalqSale> {
  const created = await calqPost(creds, "/sales", {
    patientId: input.patientId,
    salesItem: input.items,
    ...(input.roomId ? { roomId: input.roomId } : {}),
    ...(input.medicalPersonnelId ? { medicalPersonnelId: input.medicalPersonnelId } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  });
  return created as CalqSale;
}

/**
 * Idempotency probe for a retry that crashed between POST /sales and our DB latch: search by
 * the patient's MRN (string search works; patientId filter does not) for a recent unpaid sale
 * whose PROCEDURE items exactly match ours. Null = create a fresh one.
 */
export async function findExistingSale(
  creds: CalqCreds,
  mrn: string | null,
  procedureIds: number[],
): Promise<CalqSale | null> {
  if (!mrn) return null;
  const data = await calqGet(creds, `/sales?search=${encodeURIComponent(mrn)}`).catch(() => null);
  const sales = (Array.isArray(data) ? data : []) as CalqSale[];
  const wanted = [...procedureIds].sort((a, b) => a - b).join(",");
  const matches = sales.filter((s) => {
    if (isFullyPaid(s.status)) return false;
    const procIds = (s.items ?? [])
      .filter((i) => i.referenceType === "PROCEDURE")
      .map((i) => Number(i.referenceId))
      .sort((a, b) => a - b)
      .join(",");
    return procIds === wanted && procIds.length > 0;
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.id - a.id);
  return matches[0];
}

export function getSale(creds: CalqCreds, saleId: number | string): Promise<CalqSale> {
  return calqGet(creds, `/sales/${saleId}`) as Promise<CalqSale>;
}

/** PATCH /sales/{id} REPLACES the whole item list — always send the complete set. */
export function replaceSaleItems(
  creds: CalqCreds,
  saleId: number | string,
  salesItem: CalqSaleItem[],
): Promise<unknown> {
  return calqPatch(creds, `/sales/${saleId}`, { salesItem });
}

export function postSalePayment(
  creds: CalqCreds,
  saleId: number | string,
  payment: {
    amount: number;
    type: "DOWN_PAYMENT" | "REGULAR";
    note?: string;
    paidAt?: string;
  },
): Promise<unknown> {
  return calqPost(creds, `/sales/${saleId}/payments`, {
    methodId: Number(creds.paymentMethodId),
    ...payment,
  });
}
