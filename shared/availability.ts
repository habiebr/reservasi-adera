// When is a doctor actually bookable on a given date? Pure rule, kept out of the Calq client
// so both the doctor list and the calendar can apply it — and so it can be tested without a
// database or an EMR round-trip.

/** One slot of a dated /medical-personnels/schedules answer. */
export interface DatedSlot {
  scheduleId: number;
  startTime: string;
  /** "available" when Calq still offers it. */
  status: string;
  /** Set when slots from several doctors are merged into one grid: which doctor owns it. */
  doctorId?: number;
  doctorName?: string;
}

/** A practice session. A dated Calq answer carries only the ones on that date's weekday. */
export interface DatedSession {
  id: number;
  dayOfWeek: number;
  /** When the session closes — an antrean can be joined right up to it. */
  endTime: string;
}

export interface DatedDoctor {
  bookingOrderType: string;
  schedules?: DatedSession[];
  timeSlots?: DatedSlot[];
}

/**
 * EXACT_TIME needs at least one slot Calq still calls "available" that this app is not
 * already holding for somebody's checkout; QUEUE has no per-slot cap, so practising that day
 * is the whole of it. Shared by the doctor list and the calendar so the two can never
 * disagree about who is free.
 */
export function isDoctorOpenOnDate(
  doc: DatedDoctor,
  isHeld: (scheduleId: number, startTime: string) => boolean = () => false,
  date?: string,
  now = clinicNow(),
): boolean {
  if (doc.bookingOrderType === "EXACT_TIME") {
    return dedupeSlotsByTime(doc.timeSlots ?? []).some(
      (s) =>
        s.status === "available" && !isHeld(s.scheduleId, s.startTime) &&
        !(date && isPast(date, s.startTime, now)),
    );
  }
  // An antrean session stays joinable until the doctor stops seeing patients.
  return (doc.schedules ?? []).some((s) => !(date && isPast(date, s.endTime, now)));
}

/**
 * Calq lets one doctor carry two practice sessions that overlap on the same weekday — the
 * vaccination doctor in the sandbox has both 08:00–20:00 and 00:00–23:59 — and the dated
 * answer then emits the overlapping minutes once per schedule. Left alone the patient sees
 * 08:00 twice, and "jam tersisa" counts double.
 *
 * One entry per start time wins: a slot Calq still calls available beats a booked twin (the
 * patient can genuinely take it), otherwise the first one Calq listed, which is the tighter,
 * more deliberate session in the data seen so far.
 */
export function dedupeSlotsByTime<T extends DatedSlot>(slots: T[]): T[] {
  const best = new Map<string, T>();
  for (const s of slots) {
    const seen = best.get(s.startTime);
    if (!seen || (seen.status !== "available" && s.status === "available")) {
      best.set(s.startTime, s);
    }
  }
  return [...best.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** Civil date + time in the clinic's own zone. Calq stamps every schedule "Asia/Jakarta" and
 * quotes plain wall-clock strings, so comparisons must happen there — the server's own clock
 * runs UTC in the container and would let a 06:00 WIB slot look bookable at 00:30 WIB. */
export function clinicNow(at: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    // Intl renders midnight as "24" in some runtimes; normalise so string compare holds.
    time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`,
  };
}

/**
 * Has this moment already gone by? Calq happily lists a 00:00 slot at four in the afternoon —
 * it reports the schedule, not the clock — so every availability answer filters on this.
 * `at` is the slot's start (a jam) or the session's end (an antrean window closes when the
 * doctor stops, not when it starts).
 */
export function isPast(date: string, at: string, now = clinicNow()): boolean {
  if (date < now.date) return true;
  if (date > now.date) return false;
  return at <= now.time;
}
