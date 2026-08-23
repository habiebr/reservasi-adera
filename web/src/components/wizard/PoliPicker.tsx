import { useEffect, useState } from "react";
import { Stethoscope } from "lucide-react";
import { apiGet, type PoliOption } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { BlockProps } from "./types";

export default function PoliPicker({ slug, block, data, update }: BlockProps) {
  const [polis, setPolis] = useState<PoliOption[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<{ polis: PoliOption[] }>(`/api/calq/polis?slug=${slug}`)
      .then((r) => setPolis(r.polis))
      .catch((e) => setError(e.message));
  }, [slug]);

  // A form scoped to exactly one poli shouldn't force a meaningless choice — pre-select it.
  useEffect(() => {
    if (!polis || data.specializationId) return;
    const flat = polis.flatMap((poli) => poli.specializations.map((spec) => ({ poli, spec })));
    if (flat.length === 1) {
      const { poli, spec } = flat[0];
      update({
        poliId: poli.id,
        poliName: poli.name,
        specializationId: spec.id,
        specializationName: spec.name,
        bookingOrderType: spec.bookingOrderType,
      });
    }
  }, [polis, data.specializationId, update]);

  if (error) {
    return <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</p>;
  }
  if (!polis) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }
  if (polis.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada poli yang tersedia.</p>;
  }

  return (
    <div className="space-y-4">
      {block.description && <p className="text-sm text-muted-foreground">{block.description}</p>}
      <div role="radiogroup" aria-label="Pilihan poli" className="grid gap-3 sm:grid-cols-2">
        {polis.flatMap((poli) =>
          poli.specializations.map((spec) => {
            const selected = data.specializationId === spec.id;
            return (
              <button
                key={spec.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() =>
                  update({
                    poliId: poli.id,
                    poliName: poli.name,
                    specializationId: spec.id,
                    specializationName: spec.name,
                    bookingOrderType: spec.bookingOrderType,
                    // downstream choices reset with the poli
                    doctorId: undefined,
                    doctorName: undefined,
                    visitDate: undefined,
                    scheduleId: undefined,
                    slotTime: undefined,
                    procedureIds: [],
                    bundleIds: [],
                    jenisPembayaran: undefined,
                  })}
                className={cn(
                  "flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all",
                  selected
                    ? "border-primary bg-primary-muted"
                    : "border-border bg-card hover:border-primary/60",
                )}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                    selected ? "bg-primary text-primary-foreground" : "bg-secondary text-primary",
                  )}
                >
                  <Stethoscope className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {spec.name}
                  </span>
                  {poli.name !== spec.name && (
                    <span className="block truncate text-xs text-muted-foreground">
                      Poli {poli.name}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
