// Calq's per-day queue view, reduced to what a patient needs to know about their own visit.
//
// GET /appointments/{id} carries no queue at all (only queueNumberBpjs), so the number and
// its status can only be re-read from GET /appointments/v2?date= — one row per doctor, each
// with its dailyQueue (the number being served) and its appointments (each with its queue
// and its patient). The same rows are how a walk-in registered at the front desk — which
// has no booking here — is found: by patient id. Verified live against the sandbox on
// 2026-09-23; see docs/ARCHITECTURE.md #13.

export interface CalqQueueRef {
  id: number;
  bookedNumber: number | null;
  status: string; // BOOKED | CHECKED_IN | CANCELLED | …
  activeQueue?: boolean;
}

export interface CalqDayAppointment {
  id: number;
  date?: string;
  entryType?: string | null; // SCHEDULED | WALK_IN
  patient?: {
    id: number;
    firstName?: string | null;
    lastName?: string | null;
    dateOfBirth?: string | null;
  } | null;
  specialization?: { id: number; name: string } | null;
  queue?: CalqQueueRef | null;
  checkInTime?: string | null;
}

export interface CalqDayDoctor {
  id: number;
  title?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  queuePrefix?: string | null;
  dailyQueue?: {
    id: number;
    status: string; // OPEN | …
    currentQueueId: number | null;
    nextQueueId: number | null;
    roomId?: number | null;
    room?: { name?: string | null } | null;
  } | null;
  queueSummary?: { totalQueues: number; completedQueues: number } | null;
  schedules?: {
    id: number;
    startTime?: string;
    endTime?: string;
    appointments?: CalqDayAppointment[];
  }[];
}

export interface AppointmentQueueView {
  appointmentId: number;
  patientId: number | null;
  /** Name and birth date as the appointment carries them — see samePerson. */
  patientName: string | null;
  patientDob: string | null;
  /** Civil date of the visit (YYYY-MM-DD), as Calq reports it. */
  date: string | null;
  doctorName: string | null;
  specializationName: string | null;
  /** The practice session the visit belongs to ("16:00"–"23:59"); queue polis have no slot. */
  sessionStart: string | null;
  sessionEnd: string | null;
  /** The patient's own number, as text ("2"), or null when the queue was never issued. */
  queueNumber: string | null;
  /** Doctor's queue prefix ("G"); Calq shows it in front of the number. Null when unset. */
  queuePrefix: string | null;
  queueStatus: string | null;
  /** Number currently being called for this doctor today; null outside practice hours. */
  nowServing: string | null;
  /** Whether the doctor's daily queue is open (false when the doctor is absent/closed). */
  queueOpen: boolean;
  /** Where the doctor is calling patients from, when Calq has a room assigned. */
  roomName: string | null;
}

const numText = (n: number | null | undefined) => (n == null ? null : String(n));
const text = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

/** Index a day's doctors by appointment id, so a booking finds its own queue in O(1). */
export function indexDayQueues(doctors: CalqDayDoctor[]): Map<number, AppointmentQueueView> {
  const out = new Map<number, AppointmentQueueView>();
  for (const d of doctors ?? []) {
    const queuesById = new Map<number, CalqQueueRef>();
    for (const s of d.schedules ?? []) {
      for (const a of s.appointments ?? []) if (a.queue) queuesById.set(a.queue.id, a.queue);
    }
    const dq = d.dailyQueue ?? null;
    // Calq keeps currentQueueId pointing at a queue even after that queue is cancelled and
    // dropped from the appointment list, so resolve it through the list, never trust the id.
    const current = dq?.currentQueueId != null ? queuesById.get(dq.currentQueueId) : undefined;
    const nowServing = current && current.status !== "CANCELLED"
      ? numText(current.bookedNumber)
      : null;
    const doctorName = text([d.title, d.firstName, d.lastName].filter(Boolean).join(" "));
    const base = {
      doctorName,
      queuePrefix: text(d.queuePrefix),
      nowServing,
      queueOpen: dq?.status === "OPEN",
      roomName: text(dq?.room?.name),
    };
    for (const s of d.schedules ?? []) {
      for (const a of s.appointments ?? []) {
        out.set(a.id, {
          ...base,
          appointmentId: a.id,
          patientId: a.patient?.id ?? null,
          patientName: text(
            [a.patient?.firstName, a.patient?.lastName].filter(Boolean).join(" "),
          ),
          patientDob: text(a.patient?.dateOfBirth)?.slice(0, 10) ?? null,
          date: text(a.date),
          specializationName: text(a.specialization?.name),
          sessionStart: text(s.startTime),
          sessionEnd: text(s.endTime),
          queueNumber: numText(a.queue?.bookedNumber),
          queueStatus: a.queue?.status ?? null,
        });
      }
    }
  }
  return out;
}

/** A `date` column comes back from postgres.js as a local-midnight Date; keep the civil day. */
export function civilDate(v: unknown): string {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v ?? "").slice(0, 10);
}

/** Today's civil date at the clinic (Asia/Jakarta), whatever the server's zone is. */
export function clinicToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** `date` plus `n` civil days, without touching timezones. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const nameKey = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Whether a day-view appointment belongs to the patient the NIK resolved to. The id is the
 * normal match. The name + birth date match covers a front-desk duplicate: the clinic
 * registers a visit under a fresh record, later merges it into the older record, and the
 * visit keeps pointing at the now soft-deleted id, which no NIK search can reach any more
 * (seen in production 2026-09-23). Both records carry the same person's name and birth
 * date, and the birth date is the same second factor the whole endpoint rests on.
 */
export function samePerson(
  v: { patientId: number | null; patientName: string | null; patientDob: string | null },
  patient: { id: number; name: string | null; dob: string | null },
): boolean {
  if (v.patientId != null && v.patientId === patient.id) return true;
  if (!patient.dob || !patient.name || !v.patientDob || !v.patientName) return false;
  return v.patientDob === patient.dob && nameKey(v.patientName) === nameKey(patient.name);
}
