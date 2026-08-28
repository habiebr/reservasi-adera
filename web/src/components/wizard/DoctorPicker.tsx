import { useEffect, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Clock, Search, UserRound } from "lucide-react";
import { apiGet, type DoctorOption } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import SlotList from "./SlotList";
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

export default function DoctorPicker(
  { slug, data, update, dateFirst, scheduleConfig }: BlockProps,
) {
  const [doctors, setDoctors] = useState<DoctorOption[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  // Date-first: ask the server about that exact date, so the list reflects who is really
  // bookable then — not merely who practises on that weekday.
  const forDate = dateFirst ? data.visitDate : undefined;

  useEffect(() => {
    if (!data.specializationId) return;
    if (dateFirst && !forDate) return;
    setDoctors(null);
    setError("");
    apiGet<{ doctors: DoctorOption[] }>(
      `/api/calq/doctors?slug=${slug}&specializationId=${data.specializationId}` +
        (forDate ? `&date=${forDate}` : ""),
    )
      .then((r) => setDoctors(r.doctors))
      .catch((e) => setError(e.message));
  }, [slug, data.specializationId, dateFirst, forDate]);

  if (!data.specializationId) {
    return <p className="text-sm text-muted-foreground">Pilih poli terlebih dahulu.</p>;
  }
  if (dateFirst && !data.visitDate) {
    return <p className="text-sm text-muted-foreground">Pilih tanggal terlebih dahulu.</p>;
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
  // Date-first: only whoever is on duty that day, per Calq's own answer for that date.
  const visitDay = data.visitDate ? new Date(`${data.visitDate}T12:00:00`) : null;
  const onDuty = dateFirst && visitDay
    ? doctors.filter((d) => d.practicesOnDate ?? d.practiceDays.includes(visitDay.getDay()))
    : doctors;
  const anyFree = onDuty.some((d) => d.available !== false);

  if (onDuty.length === 0 || !anyFree) {
    const hari = visitDay ? format(visitDay, "EEEE, d MMMM yyyy", { locale: localeId }) : "";
    return (
      <p className="rounded-lg bg-warning-muted p-4 text-sm text-warning-foreground">
        {!dateFirst || !visitDay
          ? "Belum ada dokter dengan jadwal praktik di poli ini."
          : onDuty.length === 0
          ? `Tidak ada dokter yang praktik pada ${hari} — silakan kembali dan pilih tanggal lain.`
          : `Jadwal semua dokter pada ${hari} sudah penuh — silakan kembali dan pilih tanggal lain.`}
      </p>
    );
  }

  // A search box over two names is clutter; past a handful it is the fastest way in.
  const searchable = onDuty.length > 3;
  const q = query.trim().toLowerCase();
  const shown = q ? onDuty.filter((d) => d.name.toLowerCase().includes(q)) : onDuty;

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
        const full = doc.available === false;
        return (
          <div key={doc.id}>
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={full}
            onClick={() =>
              update({
                doctorId: doc.id,
                doctorName: doc.name,
                practiceDays: doc.practiceDays,
                bookingOrderType: doc.bookingOrderType,
                // date-first already has the date — only the slot needs re-picking
                visitDate: dateFirst ? data.visitDate : undefined,
                scheduleId: undefined,
                slotTime: undefined,
                sessionLabel: undefined,
              })}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-all",
              full
                ? "cursor-not-allowed border-border bg-muted opacity-60"
                : selected
                ? "border-primary bg-primary-muted"
                : "border-border bg-card hover:border-primary/60",
            )}
          >
            <DoctorAvatar url={doc.photoUrl} selected={selected} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">{doc.name}</span>
              {dateFirst && (
                <span
                  className={cn(
                    "mt-1 block text-xs font-medium",
                    full ? "text-muted-foreground" : "text-success",
                  )}
                >
                  {full
                    ? "Penuh pada tanggal ini"
                    : typeof doc.slotsLeft === "number"
                    ? `${doc.slotsLeft} jam tersisa`
                    : "Tersedia pada tanggal ini"}
                </span>
              )}
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
          {/* Date-first: the jam/sesi picker rides along here — this is the first moment both
              the date and the doctor are known, which is all Calq needs to quote slots. */}
          {dateFirst && selected && data.visitDate && (
            <div className="mt-3 rounded-xl border border-border bg-secondary/30 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock className="h-4 w-4 text-primary" /> Pilih jam kunjungan
              </p>
              <SlotList
                slug={slug}
                specializationId={data.specializationId!}
                doctorId={doc.id}
                date={data.visitDate}
                timeDisplay={scheduleConfig.timeDisplay ?? "segmented"}
                data={data}
                update={update}
              />
            </div>
          )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
