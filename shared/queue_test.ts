// deno test shared/
import { assertEquals } from "jsr:@std/assert@1";
import { civilDate, indexDayQueues } from "./queue.ts";

// Shape captured from the sandbox on 2026-09-23 after check-in + "next" on doctor 4.
const day = [
  {
    id: 4,
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
      { id: 225, appointments: [] },
      {
        id: 226,
        appointments: [
          {
            id: 21198,
            queue: { id: 20559, bookedNumber: 2, status: "CHECKED_IN", activeQueue: true },
          },
          {
            id: 21199,
            queue: { id: 20560, bookedNumber: 3, status: "BOOKED", activeQueue: false },
          },
        ],
      },
    ],
  },
  {
    id: 3,
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
      appointments: [{ id: 21168, queue: { id: 20529, bookedNumber: 1, status: "BOOKED" } }],
    }],
  },
];

Deno.test("own number, status and the number being served come from the doctor's row", () => {
  const idx = indexDayQueues(day);
  assertEquals(idx.get(21199), {
    queueNumber: "3",
    queuePrefix: null,
    queueStatus: "BOOKED",
    nowServing: "2",
    queueOpen: true,
    roomName: null,
  });
  assertEquals(idx.get(21198)?.queueStatus, "CHECKED_IN");
});

Deno.test("prefix and room follow the doctor; no current queue means nothing is being served", () => {
  const v = indexDayQueues(day).get(21168);
  assertEquals(v?.queuePrefix, "G");
  assertEquals(v?.roomName, "02");
  assertEquals(v?.nowServing, null);
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
  assertEquals(v, {
    queueNumber: null,
    queuePrefix: null,
    queueStatus: null,
    nowServing: null,
    queueOpen: false,
    roomName: null,
  });
});

Deno.test("civilDate keeps the calendar day of a local-midnight Date and passes strings through", () => {
  assertEquals(civilDate(new Date(2026, 8, 23)), "2026-09-23");
  assertEquals(civilDate("2026-09-23T00:00:00.000Z"), "2026-09-23");
  assertEquals(civilDate(null), "");
});
