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
  | "summary_consent";

/** Core blocks: exactly one each, enabled, in this relative order across the whole form. */
export const SEQUENCE: BlockKind[] = [
  "poli_picker",
  "doctor_picker",
  "schedule_picker",
  "patient_lookup",
  "patient_data",
  "pricing_payment",
  "summary_consent",
];

export const BLOCK_LABELS: Record<BlockKind, string> = {
  info_page: "Halaman Info",
  poli_picker: "Pilih Poli",
  doctor_picker: "Pilih Dokter",
  schedule_picker: "Pilih Jadwal",
  patient_lookup: "Cek NIK / No. RM",
  patient_data: "Data Pasien",
  pricing_payment: "Tindakan & Pembayaran",
  summary_consent: "Ringkasan & Persetujuan",
};

export interface CustomField {
  id: string;
  label: string;
  fieldType: "text" | "textarea" | "choice";
  options: string[];
  required: boolean;
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
  allowedProcedures?: AllowedRef[];
  // pricing_payment, pricingMode "package": which bundles to offer (empty = all active)
  allowedBundles?: AllowedBundleRef[];
  // summary_consent
  consentText?: string;
  // info_page
  infoBody?: string;
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

  // Relative order of the core blocks across the flattened list.
  const coreOrder = flat.filter((b) => CORE.has(b.kind)).map((b) => b.kind);
  const expected = SEQUENCE.filter((k) => coreOrder.includes(k));
  for (let i = 0; i < Math.min(coreOrder.length, expected.length); i++) {
    if (coreOrder[i] !== expected[i]) {
      problems.push(
        `Urutan blok salah: "${BLOCK_LABELS[coreOrder[i]]}" tidak boleh sebelum "${BLOCK_LABELS[expected[i]]}".`,
      );
      break;
    }
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
      if (block.kind === "patient_data") {
        for (const f of block.config.customFields ?? []) {
          if (!f.label.trim()) problems.push("Ada isian tambahan tanpa label.");
          if (f.fieldType === "choice" && f.options.filter((o) => o.trim()).length < 2) {
            problems.push(`Isian pilihan "${f.label || "(tanpa label)"}" butuh minimal 2 opsi.`);
          }
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
