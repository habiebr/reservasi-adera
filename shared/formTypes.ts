// Form-definition wire model. The database stores this relationally
// (forms → form_pages → form_blocks → allow-lists/fields); the server assembles rows into
// this shape for the builder and the public wizard, and decomposes it back on save.

export type BlockKind =
  | "info_page"
  | "poli_picker"
  | "doctor_picker"
  | "schedule_picker"
  | "patient_lookup"
  | "patient_data"
  | "pricing_payment"
  | "summary_consent"
  | "screening";

/** Core blocks: exactly one each, enabled. Also the order a new form starts out in. */
export const SEQUENCE: BlockKind[] = [
  "poli_picker",
  "doctor_picker",
  "schedule_picker",
  "patient_lookup",
  "patient_data",
  "pricing_payment",
  "summary_consent",
];

/**
 * Which stage of the flow each core block belongs to. Stages must appear in ascending order,
 * but blocks *sharing* a stage may be arranged either way round: some polis are browsed by
 * doctor ("siapa dokternya, lalu kapan praktik"), others by date ("kapan bisa datang, lalu
 * siapa yang praktik hari itu"). Only dokter ↔ jadwal share a stage today.
 */
const STAGE: Record<BlockKind, number> = {
  poli_picker: 0,
  doctor_picker: 1,
  schedule_picker: 1,
  patient_lookup: 2,
  patient_data: 3,
  pricing_payment: 4,
  summary_consent: 5,
  // not core — never consulted, listed to keep the record exhaustive
  info_page: -1,
  screening: -1,
};

export const BLOCK_LABELS: Record<BlockKind, string> = {
  info_page: "Halaman Info",
  poli_picker: "Pilih Poli",
  doctor_picker: "Pilih Dokter",
  schedule_picker: "Pilih Jadwal",
  patient_lookup: "Cek NIK / No. RM",
  patient_data: "Data Pasien",
  pricing_payment: "Tindakan & Pembayaran",
  summary_consent: "Ringkasan & Persetujuan",
  screening: "Skrining",
};

export interface CustomField {
  id: string;
  label: string;
  fieldType: "text" | "textarea" | "choice";
  options: string[];
  required: boolean;
}

/** A Ya/Tidak screening question. When the patient answers `blockAnswer`, the flow stops
 * with `blockMessage` (or a default) — e.g. pre-vaccination contraindication checks. */
export interface ScreeningQuestion {
  id: string;
  text: string;
  blockAnswer?: "Ya" | "Tidak" | "";
  blockMessage?: string;
}

export interface AllowedRef {
  id: number;
  name: string;
}

export interface AllowedBundleRef {
  id: string; // bundle uuid
  name: string;
}

export interface BlockConfig {
  // schedule_picker
  maxDaysAhead?: number;
  timeDisplay?: "segmented" | "dropdown";
  // patient_lookup
  allowMrn?: boolean;
  // patient_data
  askAddress?: boolean;
  customFields?: CustomField[];
  // pricing_payment
  pricingMode?: "procedure" | "package";
  dpEnabled?: boolean;
  dpRule?: "calq" | "fixed" | "percent";
  dpValue?: number;
  // poli_picker / pricing_payment allow-lists (empty = everything active in Calq)
  allowedSpecializations?: AllowedRef[];
  /** poli_picker: this form serves exactly one poli — the step is dropped from the wizard and
   * the poli is filled in for the patient. Requires exactly one entry in the allow-list. */
  singlePoli?: boolean;
  allowedProcedures?: AllowedRef[];
  // pricing_payment, pricingMode "package": which bundles to offer (empty = all active)
  allowedBundles?: AllowedBundleRef[];
  // summary_consent
  consentText?: string;
  // info_page
  infoBody?: string;
  /** info_page: patient must tick "saya telah membaca" before continuing */
  requireAck?: boolean;
  // screening
  screeningQuestions?: ScreeningQuestion[];
}

export interface FormBlock {
  id: string;
  kind: BlockKind;
  enabled: boolean;
  title?: string;
  description?: string;
  config: BlockConfig;
}

export interface FormPage {
  id: string;
  title: string;
  blocks: FormBlock[];
}

export interface FormDefinition {
  schemaVersion: 1;
  pages: FormPage[];
}

export interface FormBranding {
  headline?: string;
  description?: string;
  footerNote?: string;
}

const CORE: Set<BlockKind> = new Set(SEQUENCE);

export function isCoreKind(kind: BlockKind): boolean {
  return CORE.has(kind);
}

/**
 * The single poli a form is dedicated to, or null when the patient still has to choose.
 * Built for embedding a form in one poli's own page: the wizard skips straight to the first
 * real question instead of showing a one-card list.
 */
export function singlePoliOf(def: FormDefinition): AllowedRef | null {
  for (const page of def.pages) {
    for (const b of page.blocks) {
      if (b.kind !== "poli_picker" || !b.config.singlePoli) continue;
      const only = b.config.allowedSpecializations ?? [];
      return only.length === 1 ? only[0] : null;
    }
  }
  return null;
}

/**
 * True when the form asks for the visit date *before* the doctor. The wizard flips its two
 * pickers around this: the calendar then offers every day any doctor in the poli practices,
 * the doctor list narrows to whoever practises on the chosen day, and the jam/sesi picker
 * moves along with it — Calq can only quote slots once both date and doctor are known.
 */
export function isDateFirst(def: FormDefinition): boolean {
  const flat = def.pages.flatMap((p) => p.blocks).filter((b) => b.enabled);
  const doctorAt = flat.findIndex((b) => b.kind === "doctor_picker");
  const scheduleAt = flat.findIndex((b) => b.kind === "schedule_picker");
  return scheduleAt >= 0 && (doctorAt < 0 || scheduleAt < doctorAt);
}

/**
 * Validate a definition for publishing. Returns a list of human-readable (Indonesian)
 * problems; an empty list means the form is publishable. The builder shows these live;
 * the server enforces them at publish time and on every save of a published form.
 */
export function validateDefinition(def: FormDefinition): string[] {
  const problems: string[] = [];
  if (!def || def.schemaVersion !== 1) {
    return ["Definisi form tidak valid (schemaVersion harus 1)."];
  }
  if (!Array.isArray(def.pages) || def.pages.length === 0) {
    return ["Form belum punya halaman."];
  }

  const flat = def.pages.flatMap((p) => p.blocks);

  for (const kind of SEQUENCE) {
    const found = flat.filter((b) => b.kind === kind);
    if (found.length === 0) {
      problems.push(`Blok "${BLOCK_LABELS[kind]}" belum ditambahkan.`);
    } else if (found.length > 1) {
      problems.push(`Blok "${BLOCK_LABELS[kind]}" hanya boleh satu.`);
    } else if (!found[0].enabled) {
      problems.push(`Blok "${BLOCK_LABELS[kind]}" harus aktif.`);
    }
  }

  // Stage order of the core blocks across the flattened list: never allowed to go backwards.
  // Equal stages are fine in any order — that is what makes dokter ↔ jadwal interchangeable.
  const coreOrder = flat.filter((b) => CORE.has(b.kind)).map((b) => b.kind);
  let peakKind: BlockKind | null = null;
  for (const kind of coreOrder) {
    if (peakKind !== null && STAGE[kind] < STAGE[peakKind]) {
      problems.push(
        `Urutan blok salah: "${BLOCK_LABELS[kind]}" tidak boleh sebelum "${BLOCK_LABELS[peakKind]}".`,
      );
      break;
    }
    if (peakKind === null || STAGE[kind] > STAGE[peakKind]) peakKind = kind;
  }

  for (const page of def.pages) {
    for (const block of page.blocks) {
      if (block.kind === "pricing_payment") {
        const c = block.config;
        if (c.dpEnabled && c.dpRule === "fixed" && !(Number(c.dpValue) > 0)) {
          problems.push("DP tetap butuh nominal lebih dari 0.");
        }
        if (
          c.dpEnabled && c.dpRule === "percent" &&
          !(Number(c.dpValue) > 0 && Number(c.dpValue) < 100)
        ) {
          problems.push("DP persen harus antara 1–99.");
        }
      }
      if (block.kind === "poli_picker" && block.config.singlePoli) {
        const only = block.config.allowedSpecializations ?? [];
        if (only.length !== 1) {
          problems.push(
            only.length === 0
              ? "Form khusus satu poli: pilih dulu polinya."
              : "Form khusus satu poli: hanya boleh satu poli yang dipilih.",
          );
        }
      }
      if (block.kind === "patient_data") {
        for (const f of block.config.customFields ?? []) {
          if (!f.label.trim()) problems.push("Ada isian tambahan tanpa label.");
          if (f.fieldType === "choice" && f.options.filter((o) => o.trim()).length < 2) {
            problems.push(`Isian pilihan "${f.label || "(tanpa label)"}" butuh minimal 2 opsi.`);
          }
        }
      }
      if (block.kind === "screening" && block.enabled) {
        const qs = block.config.screeningQuestions ?? [];
        if (qs.length === 0) problems.push("Blok Skrining belum punya pertanyaan.");
        if (qs.some((q) => !q.text.trim())) {
          problems.push("Ada pertanyaan skrining tanpa teks.");
        }
      }
    }
  }

  return problems;
}

/** A fresh block of the given kind with sensible defaults. */
export function newBlock(kind: BlockKind, id: string): FormBlock {
  const config: BlockConfig = {};
  if (kind === "schedule_picker") {
    config.maxDaysAhead = 30;
    config.timeDisplay = "segmented";
  }
  if (kind === "patient_lookup") config.allowMrn = true;
  if (kind === "patient_data") {
    config.askAddress = true;
    config.customFields = [];
  }
  if (kind === "pricing_payment") {
    config.pricingMode = "procedure";
    config.dpEnabled = true;
    config.dpRule = "calq";
    config.dpValue = 100000;
    config.allowedProcedures = [];
  }
  if (kind === "poli_picker") config.allowedSpecializations = [];
  if (kind === "summary_consent") {
    config.consentText =
      "Saya menyetujui pemrosesan data pribadi saya untuk keperluan reservasi dan layanan kesehatan di Klinik Adera.";
  }
  if (kind === "screening") config.screeningQuestions = [];
  return { id, kind, enabled: true, config };
}

/** The default starter definition for a new form: one core block per page, in order. */
export function defaultDefinition(makeId: () => string): FormDefinition {
  const pageTitles: Record<BlockKind, string> = {
    poli_picker: "Pilih Poli",
    doctor_picker: "Pilih Dokter",
    schedule_picker: "Pilih Jadwal",
    patient_lookup: "Data Pasien",
    patient_data: "Data Pasien",
    pricing_payment: "Pembayaran",
    summary_consent: "Konfirmasi",
    info_page: "",
    screening: "Skrining",
  };
  const pages: FormPage[] = [];
  for (const kind of SEQUENCE) {
    // lookup + data share one page by default
    if (kind === "patient_data" && pages.length > 0) {
      pages[pages.length - 1].blocks.push(newBlock(kind, makeId()));
      continue;
    }
    pages.push({ id: makeId(), title: pageTitles[kind], blocks: [newBlock(kind, makeId())] });
  }
  return { schemaVersion: 1, pages };
}
