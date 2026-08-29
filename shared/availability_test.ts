// deno test shared/
import { assertEquals } from "jsr:@std/assert@1";
import {
  clinicNow,
  dedupeSlotsByTime,
  isDoctorOpenOnDate,
  isPast,
} from "./availability.ts";

const slot = (scheduleId: number, startTime: string, status: string) => ({
  scheduleId,
  startTime,
  status,
});
const session = (id: number, dayOfWeek: number, endTime = "16:00") => ({
  id,
  dayOfWeek,
  endTime,
});

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

Deno.test("overlapping Calq schedules collapse to one slot per jam", () => {
  // Calq emits 08:00 twice when a doctor has 08:00–20:00 and 00:00–23:59 on the same day.
  const slots = [
    slot(282, "08:00", "available"),
    slot(240, "08:00", "available"),
    slot(282, "08:15", "booked"),
    slot(240, "08:15", "available"),
    slot(240, "22:00", "available"),
  ];
  const unique = dedupeSlotsByTime(slots);
  assertEquals(unique.map((s) => s.startTime), ["08:00", "08:15", "22:00"]);
  // the twin the patient can actually take wins
  assertEquals(unique[1].scheduleId, 240);
  // a jam only the wider schedule covers survives
  assertEquals(unique[2].scheduleId, 240);
});

Deno.test("doubled slots do not inflate availability", () => {
  const doubled = {
    bookingOrderType: "EXACT_TIME",
    schedules: [session(282, 6)],
    timeSlots: [slot(282, "08:00", "booked"), slot(240, "08:00", "booked")],
  };
  assertEquals(isDoctorOpenOnDate(doubled), false);
});

// ── the clock ──

const now = { date: "2026-08-29", time: "14:30" };

Deno.test("isPast compares wall-clock dates and times", () => {
  assertEquals(isPast("2026-08-28", "23:45", now), true); // kemarin
  assertEquals(isPast("2026-08-30", "00:00", now), false); // besok
  assertEquals(isPast("2026-08-29", "14:00", now), true); // sudah lewat hari ini
  assertEquals(isPast("2026-08-29", "15:00", now), false); // nanti sore
});

Deno.test("EXACT_TIME: jam yang sudah lewat hari ini tidak dihitung tersedia", () => {
  const doc = {
    bookingOrderType: "EXACT_TIME",
    schedules: [session(282, 6, "23:59")],
    timeSlots: [slot(282, "08:00", "available"), slot(282, "15:00", "available")],
  };
  assertEquals(isDoctorOpenOnDate(doc, undefined, "2026-08-29", now), true);
  // hanya menyisakan jam pagi → hari ini sudah lewat
  const pagiSaja = { ...doc, timeSlots: [slot(282, "08:00", "available")] };
  assertEquals(isDoctorOpenOnDate(pagiSaja, undefined, "2026-08-29", now), false);
  // tanggal lain tetap terbuka
  assertEquals(isDoctorOpenOnDate(pagiSaja, undefined, "2026-08-30", now), true);
});

Deno.test("QUEUE: sesi yang sudah tutup tidak bisa diikuti lagi", () => {
  const pagi = { bookingOrderType: "QUEUE", schedules: [session(1, 6, "12:00")], timeSlots: [] };
  const sore = { bookingOrderType: "QUEUE", schedules: [session(2, 6, "20:00")], timeSlots: [] };
  assertEquals(isDoctorOpenOnDate(pagi, undefined, "2026-08-29", now), false);
  assertEquals(isDoctorOpenOnDate(sore, undefined, "2026-08-29", now), true);
  assertEquals(isDoctorOpenOnDate(pagi, undefined, "2026-08-30", now), true);
});

Deno.test("clinicNow membaca jam Jakarta, bukan jam server", () => {
  // 2026-08-29T18:30Z = 2026-08-30 01:30 WIB — harinya sudah berganti di klinik.
  const wib = clinicNow(new Date("2026-08-29T18:30:00Z"));
  assertEquals(wib.date, "2026-08-30");
  assertEquals(wib.time, "01:30");
});
