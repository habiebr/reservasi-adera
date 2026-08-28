// deno test shared/
import { assertEquals } from "jsr:@std/assert@1";
import { isDoctorOpenOnDate } from "./availability.ts";

const slot = (scheduleId: number, startTime: string, status: string) => ({
  scheduleId,
  startTime,
  status,
});
const session = (id: number, dayOfWeek: number) => ({ id, dayOfWeek });

Deno.test("QUEUE doctor is open whenever that day has a session", () => {
  assertEquals(
    isDoctorOpenOnDate({ bookingOrderType: "QUEUE", schedules: [session(9, 1)], timeSlots: [] }),
    true,
  );
  assertEquals(
    isDoctorOpenOnDate({ bookingOrderType: "QUEUE", schedules: [], timeSlots: [] }),
    false,
  );
});

Deno.test("EXACT_TIME doctor is open only while a slot is still free", () => {
  const doc = {
    bookingOrderType: "EXACT_TIME",
    schedules: [session(9, 1)],
    timeSlots: [slot(9, "09:00", "available"), slot(9, "09:30", "booked")],
  };
  assertEquals(isDoctorOpenOnDate(doc), true);
  // Calq says free, but this app is already holding it for someone's checkout.
  assertEquals(isDoctorOpenOnDate(doc, (id, start) => id === 9 && start === "09:00"), false);
});

Deno.test("EXACT_TIME doctor whose slots are all taken is full, not merely off duty", () => {
  assertEquals(
    isDoctorOpenOnDate({
      bookingOrderType: "EXACT_TIME",
      schedules: [session(9, 1)],
      timeSlots: [slot(9, "09:00", "booked")],
    }),
    false,
  );
});
