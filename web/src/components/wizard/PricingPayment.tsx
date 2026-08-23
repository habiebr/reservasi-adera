import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Square, Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, type ProceduresResponse } from "@/lib/api";
import { amountDue, dpAmount, formatRupiah, totalAmount, type PricedItem } from "@shared/pricing";
import { cn } from "@/lib/utils";
import type { BlockProps } from "./types";

export default function PricingPayment({ slug, block, data, update }: BlockProps) {
  const [resp, setResp] = useState<ProceduresResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!data.specializationId) return;
    setResp(null);
    apiGet<ProceduresResponse>(
      `/api/calq/procedures?slug=${slug}&specializationId=${data.specializationId}`,
    )
      .then(setResp)
      .catch((e) => setError(e.message));
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

  const dpCfg = useMemo(
    () => ({
      dpEnabled: resp?.dp.enabled ?? false,
      dpRule: resp?.dp.rule ?? ("calq" as const),
      dpValue: resp?.dp.value ?? undefined,
    }),
    [resp],
  );
  const total = totalAmount(items);
  const dp = dpAmount(items, dpCfg);

  if (!data.specializationId) {
    return <p className="text-sm text-muted-foreground">Pilih poli terlebih dahulu.</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</p>;
  }
  if (!resp) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    );
  }
  if (resp.procedures.length === 0) {
    return (
      <p className="rounded-lg bg-warning-muted p-4 text-sm text-warning-foreground">
        Belum ada tindakan yang tersedia untuk poli ini.
      </p>
    );
  }

  const toggle = (id: number) => {
    const next = data.procedureIds.includes(id)
      ? data.procedureIds.filter((x) => x !== id)
      : [...data.procedureIds, id];
    update({ procedureIds: next, jenisPembayaran: undefined });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">Pilih tindakan</p>
        <div className="space-y-2">
          {resp.procedures.map((p) => {
            const selected = data.procedureIds.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border-2 p-3.5 text-left transition-all",
                  selected
                    ? "border-primary bg-primary-muted"
                    : "border-border bg-card hover:border-primary/60",
                )}
              >
                {selected
                  ? <CheckSquare className="h-5 w-5 shrink-0 text-primary" />
                  : <Square className="h-5 w-5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  {p.name}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {formatRupiah(p.price)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {items.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Wallet className="h-4 w-4 text-primary" /> Cara pembayaran
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <PaymentCard
              label="Bayar Lunas"
              amount={amountDue(items, dpCfg, "LUNAS")}
              note="Seluruh biaya dibayar sekarang."
              selected={data.jenisPembayaran === "LUNAS"}
              onSelect={() => update({ jenisPembayaran: "LUNAS" })}
            />
            {dp !== null && (
              <PaymentCard
                label="Bayar DP"
                amount={dp}
                note={`Sisa ${formatRupiah(total - dp)} dilunasi di klinik.`}
                selected={data.jenisPembayaran === "DP"}
                onSelect={() => update({ jenisPembayaran: "DP" })}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentCard({
  label,
  amount,
  note,
  selected,
  onSelect,
}: {
  label: string;
  amount: number;
  note: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "rounded-xl border-2 p-4 text-left transition-all",
        selected ? "border-primary bg-primary-muted" : "border-border bg-card hover:border-primary/60",
      )}
    >
      <span className="block text-sm font-semibold text-foreground">{label}</span>
      <span className="mt-1 block text-xl font-bold tabular-nums text-primary">
        {formatRupiah(amount)}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">{note}</span>
    </button>
  );
}
