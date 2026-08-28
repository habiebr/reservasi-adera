// deno test shared/
import { assertEquals } from "jsr:@std/assert@1";
import { defaultDefinition, isDateFirst, newBlock, validateDefinition } from "./formTypes.ts";
import { amountDue, dpAmount, totalAmount } from "./pricing.ts";
import { canonPhone, isValidNik, isValidTanggalLahir, maskDob, maskName } from "./identity.ts";

let n = 0;
const makeId = () => `id-${++n}`;

Deno.test("default definition is publishable", () => {
  assertEquals(validateDefinition(defaultDefinition(makeId)), []);
});

Deno.test("missing core block is reported", () => {
  const def = defaultDefinition(makeId);
  def.pages = def.pages.filter((p) => !p.blocks.some((b) => b.kind === "poli_picker"));
  const problems = validateDefinition(def);
  assertEquals(problems.some((p) => p.includes("Pilih Poli")), true);
});

Deno.test("wrong relative order is reported", () => {
  const def = defaultDefinition(makeId);
  // move the payment page before the poli page
  const payIdx = def.pages.findIndex((p) => p.blocks.some((b) => b.kind === "pricing_payment"));
  const [pay] = def.pages.splice(payIdx, 1);
  def.pages.unshift(pay);
  const problems = validateDefinition(def);
  assertEquals(problems.some((p) => p.includes("Urutan blok salah")), true);
});

Deno.test("jadwal before dokter is allowed — some polis are browsed by date", () => {
  const def = defaultDefinition(makeId);
  const docIdx = def.pages.findIndex((p) => p.blocks.some((b) => b.kind === "doctor_picker"));
  const schIdx = def.pages.findIndex((p) => p.blocks.some((b) => b.kind === "schedule_picker"));
  [def.pages[docIdx], def.pages[schIdx]] = [def.pages[schIdx], def.pages[docIdx]];
  assertEquals(validateDefinition(def), []);
  assertEquals(isDateFirst(def), true);
});

Deno.test("isDateFirst is false for the default doctor-first form", () => {
  assertEquals(isDateFirst(defaultDefinition(makeId)), false);
});

Deno.test("jadwal still cannot jump ahead of poli", () => {
  const def = defaultDefinition(makeId);
  const schIdx = def.pages.findIndex((p) => p.blocks.some((b) => b.kind === "schedule_picker"));
  const [sch] = def.pages.splice(schIdx, 1);
  def.pages.unshift(sch);
  const problems = validateDefinition(def);
  assertEquals(problems.some((p) => p.includes("Urutan blok salah")), true);
});

Deno.test("duplicate core block is reported", () => {
  const def = defaultDefinition(makeId);
  def.pages[0].blocks.push(newBlock("poli_picker", makeId()));
  const problems = validateDefinition(def);
  assertEquals(problems.some((p) => p.includes("hanya boleh satu")), true);
});

Deno.test("info pages are free", () => {
  const def = defaultDefinition(makeId);
  def.pages.unshift({ id: makeId(), title: "Selamat datang", blocks: [newBlock("info_page", makeId())] });
  def.pages.push({ id: makeId(), title: "Info", blocks: [newBlock("info_page", makeId())] });
  assertEquals(validateDefinition(def), []);
});

Deno.test("choice field needs 2 options", () => {
  const def = defaultDefinition(makeId);
  for (const p of def.pages) {
    for (const b of p.blocks) {
      if (b.kind === "patient_data") {
        b.config.customFields = [
          { id: makeId(), label: "Keluhan", fieldType: "choice", options: ["Satu"], required: false },
        ];
      }
    }
  }
  const problems = validateDefinition(def);
  assertEquals(problems.some((p) => p.includes("minimal 2 opsi")), true);
});

// ── pricing ──

const items = [
  { procedureId: 1, name: "Scaling", unitPrice: 300_000, quantity: 1 },
  { procedureId: 2, name: "Konsultasi", unitPrice: 100_000, quantity: 1 },
];

Deno.test("total sums items", () => {
  assertEquals(totalAmount(items), 400_000);
});

Deno.test("fixed DP", () => {
  assertEquals(dpAmount(items, { dpEnabled: true, dpRule: "fixed", dpValue: 150_000 }), 150_000);
});

Deno.test("percent DP rounds to 500", () => {
  assertEquals(dpAmount(items, { dpEnabled: true, dpRule: "percent", dpValue: 33 }), 132_000);
});

Deno.test("calq DP uses procedure config, falls back to dpValue", () => {
  const withCalq = [
    { ...items[0], isDownPayment: true, downPaymentAmount: 120_000 },
    items[1],
  ];
  assertEquals(dpAmount(withCalq, { dpEnabled: true, dpRule: "calq", dpValue: 50_000 }), 120_000);
  assertEquals(dpAmount(items, { dpEnabled: true, dpRule: "calq", dpValue: 50_000 }), 50_000);
});

Deno.test("DP >= total means no DP offer", () => {
  assertEquals(dpAmount(items, { dpEnabled: true, dpRule: "fixed", dpValue: 400_000 }), null);
  assertEquals(dpAmount(items, { dpEnabled: false, dpRule: "fixed", dpValue: 100_000 }), null);
});

Deno.test("amountDue falls back to lunas when DP unavailable", () => {
  assertEquals(amountDue(items, { dpEnabled: false, dpRule: "fixed" }, "DP"), 400_000);
  assertEquals(amountDue(items, { dpEnabled: true, dpRule: "fixed", dpValue: 150_000 }, "DP"), 150_000);
  assertEquals(amountDue(items, { dpEnabled: true, dpRule: "fixed", dpValue: 150_000 }, "LUNAS"), 400_000);
});

// ── identity ──

Deno.test("canonPhone", () => {
  assertEquals(canonPhone("0812-3456-789"), "628123456789");
  assertEquals(canonPhone("62812345678"), "62812345678");
  assertEquals(canonPhone("812345678"), "62812345678");
  assertEquals(canonPhone(""), null);
});

Deno.test("isValidNik", () => {
  assertEquals(isValidNik("9999232323230001"), true);
  assertEquals(isValidNik("123"), false);
});

Deno.test("mask helpers", () => {
  assertEquals(maskName("Budi Santoso"), "Bu** Sa*****");
  assertEquals(maskDob("1995-05-05"), "**-**-1995");
});

Deno.test("isValidTanggalLahir", () => {
  assertEquals(isValidTanggalLahir("1995-05-05"), true);
  assertEquals(isValidTanggalLahir("2999-01-01"), false);
  assertEquals(isValidTanggalLahir("1995-13-05"), false);
});
