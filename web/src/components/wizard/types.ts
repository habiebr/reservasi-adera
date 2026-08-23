import type { FormBlock, FormDefinition, FormPage } from "@shared/formTypes";

export interface WizardPatient {
  nik: string;
  mrn: string;
  nama_lengkap: string;
  tanggal_lahir: string; // YYYY-MM-DD
  jenis_kelamin: string;
  nomor_hp: string;
  email: string;
  alamat_domisili: string;
}

export interface WizardData {
  // poli
  poliId?: number;
  poliName?: string;
  specializationId?: number;
  specializationName?: string;
  bookingOrderType?: string;
  // doctor
  doctorId?: number;
  doctorName?: string;
  practiceDays?: number[];
  // schedule
  visitDate?: string;
  scheduleId?: number;
  slotTime?: string | null;
  sessionLabel?: string;
  // patient
  lookupDone?: boolean;
  found?: boolean;
  calqPatientId?: string;
  maskedName?: string;
  patient: WizardPatient;
  answers: Record<string, string>;
  // pricing
  procedureIds: number[];
  bundleIds: string[];
  jenisPembayaran?: "LUNAS" | "DP";
  consent?: boolean;
}

export const emptyPatient: WizardPatient = {
  nik: "",
  mrn: "",
  nama_lengkap: "",
  tanggal_lahir: "",
  jenis_kelamin: "",
  nomor_hp: "",
  email: "",
  alamat_domisili: "",
};

export interface BlockProps {
  slug: string;
  block: FormBlock;
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

/** Pages the patient actually steps through: enabled blocks only; a page reduced to only
 * patient_data is skipped when the lookup already found the patient. */
export function visiblePages(def: FormDefinition, data: WizardData): FormPage[] {
  return def.pages
    .map((p) => ({ ...p, blocks: p.blocks.filter((b) => b.enabled) }))
    .filter((p) => p.blocks.length > 0)
    .filter((p) => {
      const meaningful = p.blocks.filter((b) => b.kind !== "info_page");
      if (
        meaningful.length > 0 &&
        meaningful.every((b) => b.kind === "patient_data") &&
        data.found
      ) {
        return false;
      }
      return true;
    });
}

/** Whether every block on this page is satisfied (gates the Lanjut button). */
export function pageComplete(page: FormPage, data: WizardData): boolean {
  for (const block of page.blocks) {
    switch (block.kind) {
      case "poli_picker":
        if (!data.specializationId) return false;
        break;
      case "doctor_picker":
        if (!data.doctorId) return false;
        break;
      case "schedule_picker":
        if (!data.visitDate || !data.scheduleId) return false;
        if (data.bookingOrderType === "EXACT_TIME" && !data.slotTime) return false;
        break;
      case "patient_lookup":
        // Not-found is a valid outcome: the patient_data block (wherever the builder placed
        // it) gates registration itself, so the lookup page must not also require it.
        if (!data.lookupDone) return false;
        break;
      case "patient_data": {
        if (data.found) break; // existing patient — form hidden
        const p = data.patient;
        if (!data.calqPatientId) return false;
        if (!p.nama_lengkap || !p.tanggal_lahir || !p.jenis_kelamin || !p.nomor_hp) return false;
        for (const f of block.config.customFields ?? []) {
          if (f.required && !(data.answers[f.id] ?? "").trim()) return false;
        }
        break;
      }
      case "pricing_payment":
        if (data.procedureIds.length + data.bundleIds.length === 0 || !data.jenisPembayaran) {
          return false;
        }
        break;
      case "summary_consent":
        if (!data.consent) return false;
        break;
    }
  }
  return true;
}
