// The whole patient wizard as a reusable component: the /:slug route feeds it the published
// definition; the admin builder's preview feeds it the live draft (preview mode disables the
// final submit).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import type { FormBlock, FormBranding, FormDefinition, FormPage } from "@shared/formTypes";
import { Button } from "@/components/ui/button";
import { apiPost, ApiError } from "@/lib/api";
import ProgressBar from "./ProgressBar";
import PoliPicker from "./PoliPicker";
import DoctorPicker from "./DoctorPicker";
import SchedulePicker from "./SchedulePicker";
import PatientLookup from "./PatientLookup";
import PatientDataForm from "./PatientDataForm";
import PricingPayment from "./PricingPayment";
import SummaryConsent from "./SummaryConsent";
import {
  emptyPatient,
  pageComplete,
  visiblePages,
  type BlockProps,
  type WizardData,
} from "./types";

const BLOCKS: Record<string, (p: BlockProps) => JSX.Element | null> = {
  poli_picker: PoliPicker,
  doctor_picker: DoctorPicker,
  schedule_picker: SchedulePicker,
  patient_lookup: PatientLookup,
  patient_data: PatientDataForm,
  pricing_payment: PricingPayment,
  summary_consent: SummaryConsent,
};

/** Choices already made on earlier pages, so the patient stays oriented while stepping. */
function carriedRows(
  pages: FormPage[],
  step: number,
  data: WizardData,
): { label: string; value: string }[] {
  const kinds = new Set(pages.slice(0, step).flatMap((p) => p.blocks.map((b) => b.kind)));
  const rows: { label: string; value: string }[] = [];
  if (kinds.has("poli_picker") && data.specializationName) {
    rows.push({ label: "Poli", value: data.specializationName });
  }
  if (kinds.has("doctor_picker") && data.doctorName) {
    rows.push({ label: "Dokter", value: data.doctorName });
  }
  if (kinds.has("schedule_picker") && data.visitDate) {
    const tanggal = format(new Date(`${data.visitDate}T12:00:00`), "EEE, d MMM yyyy", {
      locale: localeId,
    });
    const jam = data.slotTime ?? (data.sessionLabel ? `Sesi ${data.sessionLabel}` : "");
    rows.push({ label: "Jadwal", value: jam ? `${tanggal} • ${jam}` : tanggal });
  }
  if (kinds.has("patient_lookup") || kinds.has("patient_data")) {
    const nama = data.found ? data.maskedName : data.patient.nama_lengkap;
    if (nama) rows.push({ label: "Pasien", value: nama });
  }
  const picked = data.procedureIds.length + data.bundleIds.length;
  if (kinds.has("pricing_payment") && picked > 0) {
    const bayar = data.jenisPembayaran === "DP"
      ? " • Bayar DP"
      : data.jenisPembayaran === "LUNAS"
      ? " • Bayar Lunas"
      : "";
    rows.push({ label: "Tindakan", value: `${picked} dipilih${bayar}` });
  }
  return rows;
}

function CarriedSummary({ rows }: { rows: { label: string; value: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-border bg-secondary/50 px-4 py-2.5">
      {rows.map((r) => (
        <span key={r.label} className="text-xs text-muted-foreground">
          {r.label}: <span className="font-medium text-foreground">{r.value}</span>
        </span>
      ))}
    </div>
  );
}

function InfoBlock({ block }: { block: FormBlock }) {
  return (
    <div className="flex gap-3 rounded-xl border border-info/30 bg-info/5 p-4">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" />
      <div className="text-sm text-foreground">
        {(block.config.infoBody ?? "").split("\n").map((line, i) => (
          <p key={i} className="mb-1.5 last:mb-0">{line}</p>
        ))}
      </div>
    </div>
  );
}

export default function WizardRenderer({
  slug,
  definition,
  branding,
  preview = false,
}: {
  slug: string;
  definition: FormDefinition;
  branding: FormBranding;
  preview?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const topRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const draftKey = `resv-${slug}`;
  const [data, setData] = useState<WizardData>(() => {
    if (!preview) {
      try {
        const raw = sessionStorage.getItem(draftKey);
        if (raw) {
          const parsed = JSON.parse(raw) as WizardData;
          return { ...parsed, consent: false, bundleIds: parsed.bundleIds ?? [] };
        }
      } catch { /* fresh start */ }
    }
    return { patient: { ...emptyPatient }, answers: {}, procedureIds: [], bundleIds: [] };
  });

  useEffect(() => {
    if (preview) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(data));
    } catch { /* storage unavailable */ }
  }, [data, draftKey, preview]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const update = useCallback(
    (patch: Partial<WizardData>) => setData((d) => ({ ...d, ...patch })),
    [],
  );

  const pages = useMemo(() => visiblePages(definition, data), [definition, data]);
  const clampedStep = Math.min(step, Math.max(0, pages.length - 1));
  const page = pages[clampedStep];
  const isLast = clampedStep === pages.length - 1;
  const canNext = page ? pageComplete(page, data) : false;

  const submit = async () => {
    if (preview) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const r = await apiPost<{ payment_url: string; invoice_number: string }>(
        "/api/booking/create",
        {
          slug,
          polyclinic_id: data.poliId,
          polyclinic_name: data.poliName,
          specialization_id: data.specializationId,
          specialization_name: data.specializationName,
          medical_personnel_id: data.doctorId,
          doctor_name: data.doctorName,
          calq_schedule_id: data.scheduleId,
          visit_date: data.visitDate,
          slot_time: data.slotTime ?? null,
          calq_patient_id: data.calqPatientId,
          is_new_patient: !data.found,
          patient: data.patient,
          answers: data.answers,
          procedure_ids: data.procedureIds,
          bundle_ids: data.bundleIds,
          jenis_pembayaran: data.jenisPembayaran,
        },
      );
      sessionStorage.removeItem(draftKey);
      window.location.href = r.payment_url;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body.code === "SLOT_TAKEN") {
        update({ slotTime: undefined, scheduleId: undefined });
        const schedIdx = pages.findIndex((p) => p.blocks.some((b) => b.kind === "schedule_picker"));
        if (schedIdx >= 0) setStep(schedIdx);
        setSubmitError("Slot baru saja terisi — silakan pilih jam lain.");
      } else {
        setSubmitError(e instanceof Error ? e.message : "Terjadi kesalahan, silakan coba lagi.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!page) {
    return <p className="p-6 text-sm text-muted-foreground">Form ini belum punya halaman.</p>;
  }

  return (
    <div>
      <div ref={topRef} className="scroll-mt-4" />
      <ProgressBar
        current={clampedStep + 1}
        total={pages.length}
        labels={pages.map((p) => p.title || "•")}
      />
      {/* the final page renders the full summary block — no need for the strip there */}
      {!page.blocks.some((b) => b.kind === "summary_consent") && (
        <CarriedSummary rows={carriedRows(pages, clampedStep, data)} />
      )}
      <div className="mt-8 space-y-6">
        {page.title && (
          <h2 className="font-display text-lg font-bold text-foreground">{page.title}</h2>
        )}
        {page.blocks.map((block) => {
          if (block.kind === "info_page") return <InfoBlock key={block.id} block={block} />;
          const Cmp = BLOCKS[block.kind];
          if (!Cmp) return null;
          return (
            <div key={block.id}>
              {block.title && (
                <h3 className="mb-3 text-sm font-semibold text-foreground">{block.title}</h3>
              )}
              <Cmp slug={slug} block={block} data={data} update={update} />
            </div>
          );
        })}
      </div>

      {submitError && (
        <p className="mt-6 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {submitError}
        </p>
      )}

      <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-6">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={clampedStep === 0 || submitting}
          className="h-11 gap-1"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali
        </Button>
        {isLast
          ? (
            <Button
              onClick={submit}
              disabled={!canNext || submitting || preview}
              className="h-11 min-w-[170px] gap-1 bg-success text-success-foreground hover:bg-success/90"
              title={preview ? "Nonaktif dalam pratinjau" : undefined}
            >
              {submitting ? "Memproses…" : "Lanjut ke Pembayaran"}
            </Button>
          )
          : (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext || submitting}
              className="h-11 gap-1 px-6"
            >
              Lanjut <ArrowRight className="h-4 w-4" />
            </Button>
          )}
      </div>
      {branding.footerNote && (
        <p className="mt-6 text-center text-xs text-muted-foreground">{branding.footerNote}</p>
      )}
    </div>
  );
}
