import { useEffect, useState } from "react";
import { Clock, UserRound } from "lucide-react";
import { apiGet, type DoctorOption } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { BlockProps } from "./types";

const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export default function DoctorPicker({ slug, data, update }: BlockProps) {
  const [doctors, setDoctors] = useState<DoctorOption[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!data.specializationId) return;
    setDoctors(null);
    apiGet<{ doctors: DoctorOption[] }>(
      `/api/calq/doctors?slug=${slug}&specializationId=${data.specializationId}`,
    )
      .then((r) => setDoctors(r.doctors))
      .catch((e) => setError(e.message));
  }, [slug, data.specializationId]);

  if (!data.specializationId) {
    return <p className="text-sm text-muted-foreground">Pilih poli terlebih dahulu.</p>;
  }
  if (error) {
    return <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</p>;
  }
  if (!doctors) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    );
  }
  if (doctors.length === 0) {
    return (
      <p className="rounded-lg bg-warning-muted p-4 text-sm text-warning-foreground">
        Belum ada dokter dengan jadwal praktik di poli ini.
      </p>
    );
  }

  return (
    <div role="radiogroup" aria-label="Pilihan dokter" className="space-y-3">
      {doctors.map((doc) => {
        const selected = data.doctorId === doc.id;
        return (
          <button
            key={doc.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() =>
              update({
                doctorId: doc.id,
                doctorName: doc.name,
                practiceDays: doc.practiceDays,
                bookingOrderType: doc.bookingOrderType,
                visitDate: undefined,
                scheduleId: undefined,
                slotTime: undefined,
              })}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-all",
              selected
                ? "border-primary bg-primary-muted"
                : "border-border bg-card hover:border-primary/60",
            )}
          >
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                selected ? "bg-primary text-primary-foreground" : "bg-secondary text-primary",
              )}
            >
              <UserRound className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{doc.name}</span>
              <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {doc.bookingOrderType === "EXACT_TIME"
                  ? `Per janji ${doc.sessionDuration} menit`
                  : "Sistem antrean"}
              </span>
              <span className="mt-2 flex flex-wrap gap-1">
                {doc.practiceDays.map((d) => (
                  <span
                    key={d}
                    className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                  >
                    {DAY_NAMES[d]}
                  </span>
                ))}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
