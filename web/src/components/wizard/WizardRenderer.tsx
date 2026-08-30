// The whole patient wizard as a reusable component: the /:slug route feeds it the published
// definition; the admin builder's preview feeds it the live draft (preview mode disables the
// final submit).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import type { BlockConfig, FormBlock, FormBranding, FormDefinition, FormPage } from "@shared/formTypes";
import { isDateFirst, singlePoliOf } from "@shared/formTypes";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost, ApiError, type PoliOption } from "@/lib/api";
import ProgressBar from "./ProgressBar";
import PoliPicker from "./PoliPicker";
import DoctorPicker from "./DoctorPicker";
import SchedulePicker from "./SchedulePicker";
import PatientLookup from "./PatientLookup";
import PatientDataForm from "./PatientDataForm";
import PricingPayment from "./PricingPayment";
import ScreeningBlock from "./ScreeningBlock";
import SummaryConsent from "./SummaryConsent";
import { Checkbox } from "@/components/ui/checkbox";
import {
  emptyPatient,
  nextHint,
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
  screening: ScreeningBlock,
};

/** Choices already made on earlier pages, so the patient stays oriented while stepping. */
function carriedRows(
  pages: FormPage[],
  step: number,
  data: WizardData,
  dateFirst: boolean,
): { label: string; value: string }[] {
  const kinds = new Set(pages.slice(0, step).flatMap((p) => p.blocks.map((b) => b.kind)));
  const rows: { label: string; value: string }[] = [];
  if (kinds.has("poli_picker") && data.specializationName) {
    rows.push({ label: "Poli", value: data.specializationName });
  }
  const doctorRow = kinds.has("doctor_picker") && data.doctorName && !data.doctorImplicit
    ? { label: "Dokter", value: data.doctorName }
    : null;
  let scheduleRow: { label: string; value: string } | null = null;
  if (kinds.has("schedule_picker") && data.visitDate) {
    const tanggal = format(new Date(`${data.visitDate}T12:00:00`), "EEE, d MMM yyyy", {
      locale: localeId,
    });
    const jam = data.slotTime ?? data.sessionLabel ?? "";
    scheduleRow = { label: "Jadwal", value: jam ? `${tanggal} • ${jam}` : tanggal };
  }
  // Recap the two in the order the patient actually met them.
  for (const row of dateFirst ? [scheduleRow, doctorRow] : [doctorRow, scheduleRow]) {
    if (row) rows.push(row);
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

/** What the patient has already chosen, carried forward onto later pages. One row per choice
 * stacked vertically: chips put label and value on one line and wrapped mid-value on a phone,
 * which made a long doctor name unreadable. */
function CarriedSummary({ rows }: { rows: { label: string; value: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-secondary/40">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline gap-3 px-4 py-2.5">
          <dt className="w-20 shrink-0 text-xs text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function InfoBlock({
  block,
  data,
  update,
}: {
  block: FormBlock;
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}) {
  return (
    <div className="rounded-xl border border-info/30 bg-info/5 p-4">
      <div className="flex gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" />
        <div className="text-sm text-foreground">
          {(block.config.infoBody ?? "").split("\n").map((line, i) => (
            <p key={i} className="mb-1.5 last:mb-0">{line}</p>
          ))}
        </div>
      </div>
      {block.config.requireAck && (
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 border-t border-info/20 pt-3">
          <Checkbox
            checked={Boolean(data.acks[block.id])}
            onCheckedChange={(v) =>
              update({ acks: { ...data.acks, [block.id]: v === true } })}
            className="mt-0.5"
          />
          <span className="text-sm text-foreground">
            Saya telah membaca dan memahami informasi di atas.
          </span>
        </label>
      )}
    </div>
  );
}

export default function WizardRenderer({
  slug,
  definition,
  branding,
  preview = false,
  embedded = false,
}: {
  slug: string;
  definition: FormDefinition;
  branding: FormBranding;
  preview?: boolean;
  /** Rendered inside someone else's page: payment must leave the iframe, not fill it. */
  embedded?: boolean;
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
          return {
            ...parsed,
            consent: false,
            bundleIds: parsed.bundleIds ?? [],
            acks: parsed.acks ?? {},
          };
        }
      } catch { /* fresh start */ }
    }
    return { patient: { ...emptyPatient }, answers: {}, acks: {}, procedureIds: [], bundleIds: [] };
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

  // A single-poli form never shows the picker, so the choice is resolved here instead —
  // straight from the same cached Calq list the picker would have used.
  const onlyPoli = useMemo(() => singlePoliOf(definition), [definition]);
  const [poliError, setPoliError] = useState("");
  const poliReady = !onlyPoli || Boolean(data.specializationId);

  useEffect(() => {
    if (!onlyPoli || data.specializationId) return;
    apiGet<{ polis: PoliOption[] }>(`/api/calq/polis?slug=${slug}`)
      .then((r) => {
        for (const poli of r.polis) {
          const spec = poli.specializations.find((s) => s.id === onlyPoli.id);
          if (spec) {
            update({
              poliId: poli.id,
              poliName: poli.name,
              specializationId: spec.id,
              specializationName: spec.name,
              bookingOrderType: spec.bookingOrderType,
            });
            return;
          }
        }
        setPoliError(`Poli "${onlyPoli.name}" tidak aktif di sistem klinik saat ini.`);
      })
      .catch((e) => setPoliError(e instanceof Error ? e.message : "Gagal memuat poli."));
  }, [onlyPoli, data.specializationId, slug, update]);

  const pages = useMemo(() => visiblePages(definition, data), [definition, data]);
  // Which way round the form asks for dokter and jadwal — see isDateFirst().
  const dateFirst = useMemo(() => isDateFirst(definition), [definition]);
  const scheduleConfig = useMemo<BlockConfig>(
    () =>
      definition.pages.flatMap((p) => p.blocks).find((b) => b.kind === "schedule_picker")?.config ??
        {},
    [definition],
  );
  const clampedStep = Math.min(step, Math.max(0, pages.length - 1));
  const page = pages[clampedStep];
  const isLast = clampedStep === pages.length - 1;
  const hint = page ? nextHint(page, data, dateFirst) : "Halaman belum siap";
  const canNext = hint === null;

  // A new patient is created on the way out of the data page rather than by a "Simpan"
  // button of its own: one action per page, and Lanjut is that action. Preview never posts.
  const needsRegister = !preview && !data.found && !data.calqPatientId &&
    (page?.blocks.some((b) => b.kind === "patient_data") ?? false);

  const registerPatient = async (): Promise<string> => {
    const r = await apiPost<{ calq_patient_id: string; mrn: string | null }>(
      "/api/booking/patient",
      { slug, patient: { ...data.patient, nomor_hp: data.patient.nomor_hp.replace(/\D/g, "") } },
    );
    update({ calqPatientId: r.calq_patient_id, patient: { ...data.patient, mrn: r.mrn ?? "" } });
    return r.calq_patient_id;
  };

  const goNext = async () => {
    setSubmitError("");
    if (needsRegister) {
      setSubmitting(true);
      try {
        await registerPatient();
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : "Gagal menyimpan data pasien.");
        return;
      } finally {
        setSubmitting(false);
      }
    }
    setStep((s) => s + 1);
  };

  const submit = async () => {
    if (preview) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      // `data` is stale right after registerPatient's setState — use the id it returns.
      const patientId = needsRegister ? await registerPatient() : data.calqPatientId;
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
          calq_patient_id: patientId,
          is_new_patient: !data.found,
          patient: data.patient,
          answers: data.answers,
          procedure_ids: data.procedureIds,
          bundle_ids: data.bundleIds,
          jenis_pembayaran: data.jenisPembayaran,
        },
      );
      sessionStorage.removeItem(draftKey);
      // DOKU refuses to be framed, and paying inside a strip of someone else's page is no
      // way to hand over money: take the whole tab. The click is the user activation that
      // makes a cross-origin top navigation legal; same-tab is the fallback.
      if (embedded && window.top && window.top !== window.self) {
        try {
          window.top.location.href = r.payment_url;
          return;
        } catch { /* framed by a stricter parent — fall through */ }
      }
      window.location.href = r.payment_url;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body.code === "SLOT_TAKEN") {
        update({ slotTime: undefined, scheduleId: undefined });
        const slotKind = dateFirst ? "doctor_picker" : "schedule_picker";
        const schedIdx = pages.findIndex((p) => p.blocks.some((b) => b.kind === slotKind));
        if (schedIdx >= 0) setStep(schedIdx);
        setSubmitError("Slot baru saja terisi — silakan pilih jam lain.");
      } else {
        setSubmitError(e instanceof Error ? e.message : "Terjadi kesalahan, silakan coba lagi.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (poliError) {
    return <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{poliError}</p>;
  }
  if (!poliReady) {
    return <p className="p-6 text-sm text-muted-foreground">Menyiapkan formulir…</p>;
  }
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
        <CarriedSummary rows={carriedRows(pages, clampedStep, data, dateFirst)} />
      )}
      <div className="mt-8 space-y-6">
        {page.title && (
          <h2 className="font-display text-lg font-bold text-foreground">{page.title}</h2>
        )}
        {page.blocks.map((block) => {
          if (block.kind === "info_page") {
            return <InfoBlock key={block.id} block={block} data={data} update={update} />;
          }
          const Cmp = BLOCKS[block.kind];
          if (!Cmp) return null;
          return (
            <div key={block.id}>
              {block.title && (
                <h3 className="mb-3 text-sm font-semibold text-foreground">{block.title}</h3>
              )}
              <Cmp
                slug={slug}
                definition={definition}
                block={block}
                data={data}
                update={update}
                dateFirst={dateFirst}
                scheduleConfig={scheduleConfig}
              />
            </div>
          );
        })}
      </div>

      {submitError && (
        <p className="mt-6 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {submitError}
        </p>
      )}

      {branding.footerNote && (
        <p className="mt-6 text-center text-xs text-muted-foreground">{branding.footerNote}</p>
      )}

      {/* Sticky so the action never scrolls out of reach on a long page. `sticky` (not `fixed`)
          keeps it inside the admin preview's own scroll container too. Must stay the LAST
          child: its negative bottom margin bleeds into the card's padding, so anything
          rendered after it falls outside the card and gets clipped. */}
      <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-8 flex items-center justify-between gap-3 rounded-b-2xl border-t border-border bg-card/95 px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:-mx-8 sm:-mb-8 sm:px-8">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={clampedStep === 0 || submitting}
          className="h-11 gap-1 px-4"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Kembali</span>
        </Button>
        {isLast
          ? (
            <Button
              onClick={submit}
              disabled={!canNext || submitting || preview}
              className="h-11 min-w-0 flex-1 gap-1 bg-success text-success-foreground hover:bg-success/90 sm:flex-none sm:min-w-[170px]"
              title={preview ? "Nonaktif dalam pratinjau" : undefined}
            >
              {submitting ? "Memproses…" : (hint ?? "Lanjut ke Pembayaran")}
            </Button>
          )
          : (
            <Button
              onClick={goNext}
              disabled={!canNext || submitting}
              className="h-11 min-w-0 flex-1 gap-1 px-6 sm:flex-none"
            >
              {submitting
                ? "Mendaftarkan…"
                : (hint ?? (needsRegister ? "Daftar & Lanjut" : "Lanjut"))}
              {canNext && !submitting && <ArrowRight className="h-4 w-4" />}
            </Button>
          )}
      </div>
    </div>
  );
}
