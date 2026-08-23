import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Checkbox } from "@/components/ui/checkbox";
import { apiGet, type ProceduresResponse } from "@/lib/api";
import { amountDue, dpAmount, formatRupiah, totalAmount, type PricedItem } from "@shared/pricing";
import type { BlockProps } from "./types";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

export default function SummaryConsent({ slug, block, data, update }: BlockProps) {
  const [resp, setResp] = useState<ProceduresResponse | null>(null);

  useEffect(() => {
    if (!data.specializationId) return;
    apiGet<ProceduresResponse>(
      `/api/calq/procedures?slug=${slug}&specializationId=${data.specializationId}`,
    ).then(setResp).catch(() => {});
  }, [slug, data.specializationId]);

  const items: PricedItem[] = useMemo(() => {
    if (!resp) return [];
    return data.procedureIds
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
  }, [resp, data.procedureIds]);

  const dpCfg = {
    dpEnabled: resp?.dp.enabled ?? false,
    dpRule: resp?.dp.rule ?? ("calq" as const),
    dpValue: resp?.dp.value ?? undefined,
  };
  const total = totalAmount(items);
  const due = data.jenisPembayaran ? amountDue(items, dpCfg, data.jenisPembayaran) : 0;
  const dp = dpAmount(items, dpCfg);

  const tanggal = data.visitDate
    ? format(new Date(`${data.visitDate}T12:00:00`), "EEEE, d MMMM yyyy", { locale: localeId })
    : "-";

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-bold text-foreground">Kunjungan</h3>
        <Row label="Poli" value={data.specializationName ?? "-"} />
        <Row label="Dokter" value={data.doctorName ?? "-"} />
        <Row label="Tanggal" value={tanggal} />
        <Row
          label="Jam"
          value={data.slotTime ?? (data.sessionLabel ? `Sesi ${data.sessionLabel} (antrean)` : "-")}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-bold text-foreground">Pasien</h3>
        <Row
          label="Nama"
          value={data.found ? (data.maskedName ?? "-") : data.patient.nama_lengkap || "-"}
        />
        {data.patient.mrn && <Row label="No. RM" value={data.patient.mrn} />}
        {data.patient.nik && <Row label="NIK" value={data.patient.nik.replace(/^(\d{6})\d{6}/, "$1******")} />}
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
