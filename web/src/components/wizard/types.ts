import type { BlockConfig, FormBlock, FormDefinition, FormPage } from "@shared/formTypes";
import { isDateFirst } from "@shared/formTypes";

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
  /** The doctor came with the chosen hour rather than being picked, so the wizard keeps the
   * name to itself: the patient asked for a time, not for a person. */
  doctorImplicit?: boolean;
  // schedule
  visitDate?: string;
  scheduleId?: number;
  slotTime?: string | null;
  sessionLabel?: string;
  // patient
  lookupDone?: boolean;
  found?: boolean;
  /** Identified patient ticked "Ya, ini saya" on the confirm card. */
  identityConfirmed?: boolean;
  calqPatientId?: string;
  maskedName?: string;
  maskedPhone?: string;
  patient: WizardPatient;
  answers: Record<string, string>;
  /** info_page requireAck: blockId → "sudah membaca" ticked */
  acks: Record<string, boolean>;
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
  /** The whole form: a block occasionally has to know how the form is arranged, not just
   * its own config — e.g. whether the hour grid belongs to it or to the doctor step. */
  definition: FormDefinition;
  block: FormBlock;
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  /** The form puts "Pilih Jadwal" before "Pilih Dokter" — see isDateFirst(). */
  dateFirst: boolean;
  /** The schedule block's own config, needed by whichever block ends up owning the jam
   * picker: in a date-first form that is "Pilih Dokter", not "Pilih Jadwal". */
  scheduleConfig: BlockConfig;
}

/** An hour-based poli asked for date-first: the hour grid already settles which doctor, so
 * the doctor step is not the patient's to answer. */
export function picksHourNotDoctor(def: FormDefinition, data: WizardData): boolean {
  return isDateFirst(def) && data.bookingOrderType === "EXACT_TIME";
}

/** Pages the patient actually steps through: enabled blocks only; a page reduced to only
 * patient_data is skipped when the lookup already found the patient. */
export function visiblePages(def: FormDefinition, data: WizardData): FormPage[] {
  return def.pages
    // A single-poli form answers the poli question in its own definition, so the block never
    // reaches the patient — WizardRenderer fills the choice in instead.
    .map((p) => ({
      ...p,
      blocks: p.blocks.filter((b) =>
        b.enabled &&
        !(b.kind === "poli_picker" && b.config.singlePoli) &&
        !(b.kind === "doctor_picker" && picksHourNotDoctor(def, data))
      ),
    }))
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

/** Everything /api/booking/patient rejects, checked before the request is made. */
export function patientDataComplete(p: WizardPatient): boolean {
  return /^\d{16}$/.test(p.nik) && p.nama_lengkap.trim().length >= 2 &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.tanggal_lahir) && Boolean(p.jenis_kelamin) &&
    p.nomor_hp.replace(/\D/g, "").length >= 9;
}

/** Why this page can't be left yet — null when it is satisfied. The string doubles as the
 * Lanjut button's label, so a disabled button always says what it is waiting for. */
export function nextHint(page: FormPage, data: WizardData, dateFirst = false): string | null {
  for (const block of page.blocks) {
    switch (block.kind) {
      case "info_page":
        if (block.config.requireAck && !data.acks[block.id]) return "Baca dulu informasinya";
        break;
      case "screening":
        for (const q of block.config.screeningQuestions ?? []) {
          const answer = (data.answers[q.id] ?? "").trim();
          if (!answer) return "Jawab skrining dulu";
          if (q.blockAnswer && answer === q.blockAnswer) return "Belum bisa dilanjutkan";
        }
        break;
      case "poli_picker":
        if (!data.specializationId) return "Pilih poli dulu";
        break;
      case "doctor_picker":
        if (!data.doctorId) return "Pilih dokter dulu";
        // Date-first forms pick the jam here, right under the chosen doctor.
        if (dateFirst) {
          if (!data.scheduleId) return "Pilih jadwal dulu";
          if (data.bookingOrderType === "EXACT_TIME" && !data.slotTime) return "Pilih jam dulu";
        }
        break;
      case "schedule_picker":
        if (!data.visitDate) return "Pilih tanggal dulu";
        // Date-first + antrean: the doctor step downstream asks for the session. Date-first +
        // jam: the hour grid is right here, so it is this page that must be satisfied.
        if (dateFirst && data.bookingOrderType !== "EXACT_TIME") break;
        if (data.bookingOrderType === "EXACT_TIME" && !data.slotTime) return "Pilih jam dulu";
        if (!data.scheduleId) return "Pilih jadwal dulu";
        break;
      case "patient_lookup":
        // Not-found is a valid outcome: the patient_data block (wherever the builder placed
        // it) gates registration itself, so the lookup page must not also require it.
        if (!data.lookupDone) return "Cek data pasien dulu";
        // A match must be acknowledged — the patient confirms the masked name/HP is theirs
        // before we book against that record.
        if (data.found && !data.identityConfirmed) return "Konfirmasi data Anda dulu";
        break;
      case "patient_data": {
        // No separate "Simpan" step: the block has no button of its own, and Lanjut registers
        // the patient on the way out — so this gate must cover everything the POST needs.
        if (data.found) break; // existing patient — form hidden
        if (!patientDataComplete(data.patient)) return "Lengkapi data diri dulu";
        for (const f of block.config.customFields ?? []) {
          if (f.required && !(data.answers[f.id] ?? "").trim()) return "Lengkapi data diri dulu";
        }
        break;
      }
      case "pricing_payment":
        if (data.procedureIds.length + data.bundleIds.length === 0) return "Pilih tindakan dulu";
        if (!data.jenisPembayaran) return "Pilih cara pembayaran dulu";
        break;
      case "summary_consent":
        if (!data.consent) return "Setujui ketentuan dulu";
        break;
    }
  }
  return null;
}
