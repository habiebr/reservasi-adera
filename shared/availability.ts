// When is a doctor actually bookable on a given date? Pure rule, kept out of the Calq client
// so both the doctor list and the calendar can apply it — and so it can be tested without a
// database or an EMR round-trip.

/** One slot of a dated /medical-personnels/schedules answer. */
export interface DatedSlot {
  scheduleId: number;
  startTime: string;
  /** "available" when Calq still offers it. */
  status: string;
}

/** A practice session. A dated Calq answer carries only the ones on that date's weekday. */
export interface DatedSession {
  id: number;
  dayOfWeek: number;
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
): boolean {
  if (doc.bookingOrderType === "EXACT_TIME") {
    return (doc.timeSlots ?? []).some(
      (s) => s.status === "available" && !isHeld(s.scheduleId, s.startTime),
    );
  }
  return (doc.schedules ?? []).length > 0;
}
