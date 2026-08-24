import { useEffect, useState } from "react";
import { Search, UserRound } from "lucide-react";
import { apiGet, type DoctorOption } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BlockProps } from "./types";

const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** Portrait when Calq has one, the generic icon otherwise. The URL is a signed link that can
 * expire mid-session, so a load failure falls back to the icon instead of a broken image. */
function DoctorAvatar({ url, selected }: { url?: string | null; selected: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full",
        selected ? "bg-primary text-primary-foreground" : "bg-secondary text-primary",
      )}
    >
      {url && !broken
        ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        )
        : <UserRound className="h-6 w-6" />}
    </span>
  );
}

export default function DoctorPicker({ slug, data, update }: BlockProps) {
  const [doctors, setDoctors] = useState<DoctorOption[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

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

  // A search box over two names is clutter; past a handful it is the fastest way in.
  const searchable = doctors.length > 3;
  const q = query.trim().toLowerCase();
  const shown = q ? doctors.filter((d) => d.name.toLowerCase().includes(q)) : doctors;

  return (
    <div className="space-y-3">
      {searchable && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama dokter"
            aria-label="Cari nama dokter"
            className="h-11 pl-9"
          />
        </div>
      )}
      {shown.length === 0 && (
        <p className="rounded-lg bg-warning-muted p-4 text-sm text-warning-foreground">
          Tidak ada dokter yang cocok dengan pencarian Anda.
        </p>
      )}
      <div role="radiogroup" aria-label="Pilihan dokter" className="space-y-3">
      {shown.map((doc) => {
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
            <DoctorAvatar url={doc.photoUrl} selected={selected} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{doc.name}</span>
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
    </div>
  );
}
