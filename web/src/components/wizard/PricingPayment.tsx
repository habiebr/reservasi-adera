import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Package, Square, Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, type BundlesResponse, type ProceduresResponse } from "@/lib/api";
import { amountDue, dpAmount, formatRupiah, totalAmount, type DpConfig, type PricedItem } from "@shared/pricing";
import { cn } from "@/lib/utils";
import type { BlockProps } from "./types";

export default function PricingPayment(props: BlockProps) {
  const mode = props.block.config.pricingMode ?? "procedure";
  return mode === "package" ? <PackagePricing {...props} /> : <ProcedurePricing {...props} />;
}

// ── Mode "procedure": the Calq procedure list as-is ──

function ProcedurePricing({ slug, data, update }: BlockProps) {
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

  if (!data.specializationId) {
    return <p className="text-sm text-muted-foreground">Pilih poli terlebih dahulu.</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</p>;
  }
  if (!resp) return <LoadingRows />;
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
      <PaymentSection items={items} dp={resp.dp} data={data} update={update} />
    </div>
  );
}

// ── Mode "package": the admin's curated bundle list ──

function PackagePricing({ slug, data, update }: BlockProps) {
  const [resp, setResp] = useState<BundlesResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<BundlesResponse>(`/api/calq/bundles?slug=${slug}`)
      .then(setResp)
      .catch((e) => setError(e.message));
  }, [slug]);

  const items: PricedItem[] = useMemo(() => {
    if (!resp) return [];
    return data.bundleIds
      .map((id) => resp.bundles.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .map((b) => ({
        procedureId: b.id,
        name: b.name,
        unitPrice: b.price,
        quantity: 1,
        isDownPayment: b.isDownPayment,
        downPaymentAmount: b.downPaymentAmount,
      }));
  }, [resp, data.bundleIds]);

  if (error) {
    return <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</p>;
  }
  if (!resp) return <LoadingRows />;
  if (resp.bundles.length === 0) {
    return (
      <p className="rounded-lg bg-warning-muted p-4 text-sm text-warning-foreground">
        Belum ada paket yang tersedia saat ini.
      </p>
    );
  }

  const toggle = (id: string) => {
    const next = data.bundleIds.includes(id)
      ? data.bundleIds.filter((x) => x !== id)
      : [...data.bundleIds, id];
    update({ bundleIds: next, jenisPembayaran: undefined });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">Pilih paket</p>
        <div className="space-y-2">
          {resp.bundles.map((b) => {
            const selected = data.bundleIds.includes(b.id);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggle(b.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border-2 p-3.5 text-left transition-all",
                  selected
                    ? "border-primary bg-primary-muted"
                    : "border-border bg-card hover:border-primary/60",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    selected ? "bg-primary text-primary-foreground" : "bg-secondary text-primary",
                  )}
                >
                  <Package className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-foreground">{b.name}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {formatRupiah(b.price)}
                    </span>
                  </span>
                  {b.description && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {b.description}
                    </span>
                  )}
                  {b.items.length > 1 && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Termasuk:{" "}
                      {b.items
                        .map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name))
                        .join(", ")}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <PaymentSection items={items} dp={resp.dp} data={data} update={update} />
    </div>
  );
}

// ── Shared: LUNAS / DP choice ──

function LoadingRows() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
    </div>
  );
}

function PaymentSection({
  items,
  dp,
  data,
  update,
}: {
  items: PricedItem[];
  dp: { enabled: boolean; rule: "calq" | "fixed" | "percent"; value: number | null };
  data: BlockProps["data"];
  update: BlockProps["update"];
}) {
  const dpCfg: DpConfig = {
    dpEnabled: dp.enabled,
    dpRule: dp.rule,
    dpValue: dp.value ?? undefined,
  };
  const total = totalAmount(items);
  const dpNominal = dpAmount(items, dpCfg);
  if (items.length === 0) return null;

  return (
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
        {dpNominal !== null && (
          <PaymentCard
            label="Bayar DP"
            amount={dpNominal}
            note={`Sisa ${formatRupiah(total - dpNominal)} dilunasi di klinik.`}
            selected={data.jenisPembayaran === "DP"}
            onSelect={() => update({ jenisPembayaran: "DP" })}
          />
        )}
      </div>
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
