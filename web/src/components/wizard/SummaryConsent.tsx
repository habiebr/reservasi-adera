import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Checkbox } from "@/components/ui/checkbox";
import { apiGet, type BundlesResponse, type ProceduresResponse } from "@/lib/api";
import { amountDue, dpAmount, formatRupiah, totalAmount, type PricedItem } from "@shared/pricing";
import type { BlockProps } from "./types";

/** Money rows stay label-left / amount-right — that is what a receipt should look like. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/** Detail rows stack instead, so long doctor names and dates get the full width. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold leading-snug text-foreground">{value}</dd>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

export default function SummaryConsent({ slug, block, data, update }: BlockProps) {
  const [resp, setResp] = useState<ProceduresResponse | null>(null);
  const [bundleResp, setBundleResp] = useState<BundlesResponse | null>(null);

  useEffect(() => {
    if (data.procedureIds.length === 0 || !data.specializationId) return;
    apiGet<ProceduresResponse>(
      `/api/calq/procedures?slug=${slug}&specializationId=${data.specializationId}`,
    ).then(setResp).catch(() => {});
  }, [slug, data.specializationId, data.procedureIds.length]);

  useEffect(() => {
    if (data.bundleIds.length === 0) return;
    apiGet<BundlesResponse>(`/api/calq/bundles?slug=${slug}`).then(setBundleResp).catch(() => {});
  }, [slug, data.bundleIds.length]);

  const items: PricedItem[] = useMemo(() => {
    const fromProcedures: PricedItem[] = !resp ? [] : data.procedureIds
      .map((id) => resp.procedures.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({
        procedureId: p.id,
        name: p.name,
        unitPrice: p.price,
        quantity: 1,
        isDownPayment: p.isDownPayment,
        downPaymentAmount: p.downPaymentAmount,
      }));
    const fromBundles: PricedItem[] = !bundleResp ? [] : data.bundleIds
      .map((id) => bundleResp.bundles.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .map((b) => ({
        procedureId: b.id,
        name: b.name,
        unitPrice: b.price,
        quantity: 1,
        isDownPayment: b.isDownPayment,
        downPaymentAmount: b.downPaymentAmount,
      }));
    return [...fromProcedures, ...fromBundles];
  }, [resp, bundleResp, data.procedureIds, data.bundleIds]);

  const dpSource = data.bundleIds.length > 0 ? bundleResp?.dp : resp?.dp;
  const dpCfg = {
    dpEnabled: dpSource?.enabled ?? false,
    dpRule: dpSource?.rule ?? ("calq" as const),
    dpValue: dpSource?.value ?? undefined,
  };
  const total = totalAmount(items);
  const due = data.jenisPembayaran ? amountDue(items, dpCfg, data.jenisPembayaran) : 0;
  const dp = dpAmount(items, dpCfg);

  const tanggal = data.visitDate
    ? format(new Date(`${data.visitDate}T12:00:00`), "EEEE, d MMMM yyyy", { locale: localeId })
    : "-";

  return (
    <div className="space-y-5">
      <section>
        <SectionLabel>Detail kunjungan</SectionLabel>
        <dl className="grid gap-3 rounded-xl border border-border bg-card p-4">
          <Field label="Poli" value={data.specializationName ?? "-"} />
          <Field label="Dokter" value={data.doctorName ?? "-"} />
          <Field label="Tanggal" value={tanggal} />
          <Field
            label="Jam"
            value={data.slotTime ?? (data.sessionLabel ? `Sesi ${data.sessionLabel}` : "-")}
          />
        </dl>
      </section>

      <section>
        <SectionLabel>Data pasien</SectionLabel>
        <dl className="grid gap-3 rounded-xl border border-border bg-card p-4">
          <Field
            label="Nama"
            value={data.found ? (data.maskedName ?? "-") : data.patient.nama_lengkap || "-"}
          />
          {data.patient.mrn && <Field label="No. rekam medis" value={data.patient.mrn} />}
          {data.patient.nik && (
            <Field label="NIK" value={data.patient.nik.replace(/^(\d{6})\d{6}/, "$1******")} />
          )}
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-bold text-foreground">Biaya</h3>
        {items.map((i) => <Row key={i.procedureId} label={i.name} value={formatRupiah(i.unitPrice)} />)}
        <div className="mt-2 border-t border-border pt-2">
          <Row label="Total" value={formatRupiah(total)} />
          {data.jenisPembayaran === "DP" && dp !== null && (
            <>
              <Row label="DP dibayar sekarang" value={formatRupiah(dp)} />
              <Row label="Sisa (di klinik)" value={formatRupiah(total - dp)} />
            </>
          )}
          <div className="mt-1 flex items-center justify-between rounded-lg bg-primary-muted px-3 py-2">
            <span className="text-sm font-semibold text-primary">Dibayar sekarang</span>
            <span className="text-lg font-bold tabular-nums text-primary">{formatRupiah(due)}</span>
          </div>
        </div>
      </section>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4">
        <Checkbox
          checked={Boolean(data.consent)}
          onCheckedChange={(v) => update({ consent: v === true })}
          className="mt-0.5"
        />
        <span className="text-sm text-muted-foreground">
          {block.config.consentText ??
            "Saya menyetujui pemrosesan data pribadi saya untuk keperluan reservasi dan layanan kesehatan di Klinik Adera."}
        </span>
      </label>
    </div>
  );
}
