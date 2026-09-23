// deno test shared/
import { assertEquals } from "jsr:@std/assert@1";
import { addDays, civilDate, clinicToday, indexDayQueues } from "./queue.ts";

// Shape captured from the sandbox on 2026-09-23 after check-in + "next" on doctor 4.
const day = [
  {
    id: 4,
    title: null,
    firstName: "Bidan",
    lastName: "etika",
    queuePrefix: null,
    dailyQueue: {
      id: 15657,
      status: "OPEN",
      currentQueueId: 20559,
      nextQueueId: null,
      roomId: null,
      room: null,
    },
    queueSummary: { totalQueues: 2, completedQueues: 0 },
    schedules: [
      { id: 225, startTime: "08:00", endTime: "16:00", appointments: [] },
      {
        id: 226,
        startTime: "16:00",
        endTime: "23:59",
        appointments: [
          {
            id: 21198,
            date: "2026-09-23",
            entryType: "WALK_IN",
            patient: { id: 78352, firstName: "Tes", lastName: "Reservasi Adera" },
            specialization: { id: 42, name: "Bidan" },
            queue: { id: 20559, bookedNumber: 2, status: "CHECKED_IN", activeQueue: true },
          },
          {
            id: 21199,
            date: "2026-09-23",
            patient: { id: 5 },
            specialization: { id: 42, name: "Bidan" },
            queue: { id: 20560, bookedNumber: 3, status: "BOOKED", activeQueue: false },
          },
        ],
      },
    ],
  },
  {
    id: 3,
    title: "drg.",
    firstName: "Antonius Janottama",
    lastName: "Saga",
    queuePrefix: "G",
    dailyQueue: {
      id: 15648,
      status: "OPEN",
      currentQueueId: null,
      nextQueueId: null,
      roomId: 4,
      room: { name: "02" },
    },
    schedules: [{
      id: 59,
      startTime: "08:00",
      endTime: "09:00",
      appointments: [{ id: 21168, queue: { id: 20529, bookedNumber: 1, status: "BOOKED" } }],
    }],
  },
];

Deno.test("own number, status and the number being served come from the doctor's row", () => {
  const idx = indexDayQueues(day);
  assertEquals(idx.get(21199), {
    appointmentId: 21199,
    patientId: 5,
    date: "2026-09-23",
    doctorName: "Bidan etika",
    specializationName: "Bidan",
    sessionStart: "16:00",
    sessionEnd: "23:59",
    queueNumber: "3",
    queuePrefix: null,
    queueStatus: "BOOKED",
    nowServing: "2",
    queueOpen: true,
    roomName: null,
  });
  assertEquals(idx.get(21198)?.queueStatus, "CHECKED_IN");
});

Deno.test("a walk-in is found by patient id across the day's rows", () => {
  const mine = [...indexDayQueues(day).values()].filter((v) => v.patientId === 78352);
  assertEquals(mine.map((v) => v.appointmentId), [21198]);
});

Deno.test("prefix, doctor and room follow the doctor; no current queue means nothing served", () => {
  const v = indexDayQueues(day).get(21168);
  assertEquals(v?.queuePrefix, "G");
  assertEquals(v?.doctorName, "drg. Antonius Janottama Saga");
  assertEquals(v?.roomName, "02");
  assertEquals(v?.nowServing, null);
  assertEquals(v?.patientId, null);
});

Deno.test("a stale currentQueueId that no longer resolves to a live queue is ignored", () => {
  const stale = [{
    id: 4,
    dailyQueue: { id: 1, status: "OPEN", currentQueueId: 999, nextQueueId: null },
    schedules: [{
      id: 1,
      appointments: [{ id: 7, queue: { id: 5, bookedNumber: 1, status: "BOOKED" } }],
    }],
  }];
  assertEquals(indexDayQueues(stale).get(7)?.nowServing, null);
  const cancelled = [{
    id: 4,
    dailyQueue: { id: 1, status: "OPEN", currentQueueId: 5, nextQueueId: null },
    schedules: [{
      id: 1,
      appointments: [{ id: 7, queue: { id: 5, bookedNumber: 1, status: "CANCELLED" } }],
    }],
  }];
  assertEquals(indexDayQueues(cancelled).get(7)?.nowServing, null);
});

Deno.test("an appointment Calq issued no queue for is still indexed, with nulls", () => {
  const v = indexDayQueues([{
    id: 9,
    dailyQueue: null,
    schedules: [{ id: 1, appointments: [{ id: 1 }] }],
  }]).get(1);
  assertEquals(v?.queueNumber, null);
  assertEquals(v?.queueStatus, null);
  assertEquals(v?.queueOpen, false);
  assertEquals(v?.doctorName, null);
});

Deno.test("civilDate keeps the calendar day of a local-midnight Date and passes strings through", () => {
  assertEquals(civilDate(new Date(2026, 8, 23)), "2026-09-23");
  assertEquals(civilDate("2026-09-23T00:00:00.000Z"), "2026-09-23");
  assertEquals(civilDate(null), "");
});

Deno.test("clinicToday follows Jakarta, addDays crosses month ends", () => {
  // 2026-09-23 17:30 UTC is already 2026-09-24 00:30 in Jakarta.
  assertEquals(clinicToday(new Date("2026-09-23T17:30:00Z")), "2026-09-24");
  assertEquals(clinicToday(new Date("2026-09-23T16:30:00Z")), "2026-09-23");
  assertEquals(addDays("2026-09-30", 1), "2026-10-01");
  assertEquals(addDays("2026-09-23", 6), "2026-09-29");
});
