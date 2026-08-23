// The whole patient wizard as a reusable component: the /:slug route feeds it the published
// definition; the admin builder's preview feeds it the live draft (preview mode disables the
// final submit).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import type { FormBlock, FormBranding, FormDefinition } from "@shared/formTypes";
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
        if (raw) return { ...JSON.parse(raw), consent: false } as WizardData;
      } catch { /* fresh start */ }
    }
    return { patient: { ...emptyPatient }, answers: {}, procedureIds: [] };
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
