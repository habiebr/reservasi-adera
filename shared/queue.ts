// Calq's per-day queue view, reduced to what a patient needs to know about their own visit.
//
// GET /appointments/{id} carries no queue at all (only queueNumberBpjs), so the number and
// its status can only be re-read from GET /appointments/v2?date= — one row per doctor, each
// with its dailyQueue (the number being served) and its appointments (each with its queue).
// Verified live against the sandbox on 2026-09-23; see docs/ARCHITECTURE.md #13.

export interface CalqQueueRef {
  id: number;
  bookedNumber: number | null;
  status: string; // BOOKED | CHECKED_IN | CANCELLED | …
  activeQueue?: boolean;
}

export interface CalqDayDoctor {
  id: number;
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
  schedules?: { id: number; appointments?: { id: number; queue?: CalqQueueRef | null }[] }[];
}

export interface AppointmentQueueView {
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

/** Index a day's doctors by appointment id, so a booking finds its own queue in O(1). */
export function indexDayQueues(doctors: CalqDayDoctor[]): Map<number, AppointmentQueueView> {
  const out = new Map<number, AppointmentQueueView>();
  for (const d of doctors ?? []) {
    const queuesById = new Map<number, CalqQueueRef>();
    const appts: { id: number; queue?: CalqQueueRef | null }[] = [];
    for (const s of d.schedules ?? []) {
      for (const a of s.appointments ?? []) {
        appts.push(a);
        if (a.queue) queuesById.set(a.queue.id, a.queue);
      }
    }
    const dq = d.dailyQueue ?? null;
    // Calq keeps currentQueueId pointing at a queue even after that queue is cancelled and
    // dropped from the appointment list, so resolve it through the list, never trust the id.
    const current = dq?.currentQueueId != null ? queuesById.get(dq.currentQueueId) : undefined;
    const nowServing = current && current.status !== "CANCELLED"
      ? numText(current.bookedNumber)
      : null;
    const base = {
      queuePrefix: d.queuePrefix?.trim() || null,
      nowServing,
      queueOpen: dq?.status === "OPEN",
      roomName: dq?.room?.name?.trim() || null,
    };
    for (const a of appts) {
      out.set(a.id, {
        ...base,
        queueNumber: numText(a.queue?.bookedNumber),
        queueStatus: a.queue?.status ?? null,
      });
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
