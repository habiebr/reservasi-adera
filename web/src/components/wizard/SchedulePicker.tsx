import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { CalendarDays, Loader2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, type DoctorOption } from "@/lib/api";
import SlotList from "./SlotList";
import { picksHourNotDoctor, type BlockProps } from "./types";

const fmtDate = (d: Date) => format(d, "yyyy-MM-dd");

export default function SchedulePicker(
  { slug, block, data, update, dateFirst, definition }: BlockProps,
) {
  // Hour-based poli asked date-first: the grid of hours belongs on this page, not behind a
  // doctor the patient never asked for.
  const hourFirst = picksHourNotDoctor(definition, data);
  const maxDaysAhead = block.config.maxDaysAhead ?? 30;
  const timeDisplay = block.config.timeDisplay ?? "segmented";

  // Date-first forms have no doctor yet, so the calendar opens on every day *anyone* in the
  // poli practises; the doctor block downstream narrows the list to the chosen day.
  const [poliDays, setPoliDays] = useState<number[] | null>(null);
  const [poliDaysError, setPoliDaysError] = useState("");
  // Per-date availability, fetched after the calendar is already on screen: a day whose
  // sessions are all taken gets greyed out once this lands. Absent = fall back to the
  // weekly practice days, so a slow or failed answer never blocks the patient.
  const [dayInfo, setDayInfo] = useState<Record<string, { available: boolean }> | null>(null);

  useEffect(() => {
    if (!dateFirst || !data.specializationId) return;
    setPoliDays(null);
    setPoliDaysError("");
    apiGet<{ doctors: DoctorOption[] }>(
      `/api/calq/doctors?slug=${slug}&specializationId=${data.specializationId}`,
    )
      .then((r) => setPoliDays([...new Set(r.doctors.flatMap((d) => d.practiceDays))].sort()))
      .catch((e) => setPoliDaysError(e.message));
  }, [dateFirst, slug, data.specializationId]);

  useEffect(() => {
    if (!data.specializationId) return;
    if (dateFirst ? !poliDays : !data.doctorId) return;
    setDayInfo(null);
    const from = fmtDate(new Date());
    apiGet<{ days: Record<string, { available: boolean }> }>(
      `/api/calq/days?slug=${slug}&specializationId=${data.specializationId}` +
        `&from=${from}&days=${maxDaysAhead}` +
        (dateFirst ? "" : `&doctorId=${data.doctorId}`),
    )
      .then((r) => setDayInfo(r.days))
      .catch(() => setDayInfo(null));
  }, [slug, data.specializationId, data.doctorId, dateFirst, poliDays, maxDaysAhead]);

  const practiceDays = useMemo(
    () => new Set(dateFirst ? poliDays ?? [] : data.practiceDays ?? []),
    [dateFirst, poliDays, data.practiceDays],
  );
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const maxDate = useMemo(
    () => new Date(today.getTime() + maxDaysAhead * 86_400_000),
    [today, maxDaysAhead],
  );

  if (dateFirst && !data.specializationId) {
    return <p className="text-sm text-muted-foreground">Pilih poli terlebih dahulu.</p>;
  }
  if (!dateFirst && !data.doctorId) {
    return <p className="text-sm text-muted-foreground">Pilih dokter terlebih dahulu.</p>;
  }
  if (poliDaysError) {
    return (
      <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{poliDaysError}</p>
    );
  }
  if (dateFirst && !poliDays) {
    return <Skeleton className="h-80 rounded-xl" />;
  }
  if (dateFirst && poliDays!.length === 0) {
    return (
      <p className="rounded-lg bg-warning-muted p-4 text-sm text-warning-foreground">
        Belum ada dokter dengan jadwal praktik di poli ini.
      </p>
    );
  }

  const selectedDate = data.visitDate ? new Date(`${data.visitDate}T12:00:00`) : undefined;

  // One predicate drives both the disabled state and the legend, so the two can never disagree.
  // `dayInfo` only ever narrows what the weekly schedule already allows.
  const unavailable = (d: Date) => {
    if (d < today || d > maxDate) return true;
    if (practiceDays.size > 0 && !practiceDays.has(d.getDay())) return true;
    return dayInfo?.[fmtDate(d)]?.available === false;
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-2 sm:p-4">
        <div className="mb-2 flex items-center gap-2 px-2 pt-2 text-sm font-semibold text-foreground">
          <CalendarDays className="h-4 w-4 text-primary" /> Pilih tanggal kunjungan
        </div>
        <Calendar
          mode="single"
          locale={localeId}
          selected={selectedDate}
          onSelect={(d) => {
            if (!d) return;
            // Date-first: a new date can invalidate the doctor picked downstream, so drop it.
            update(
              dateFirst
                ? {
                  visitDate: fmtDate(d),
                  doctorId: undefined,
                  doctorName: undefined,
                  doctorImplicit: undefined,
                  practiceDays: undefined,
                  scheduleId: undefined,
                  slotTime: undefined,
                  sessionLabel: undefined,
                }
                : { visitDate: fmtDate(d), scheduleId: undefined, slotTime: undefined },
            );
          }}
          disabled={unavailable}
          modifiers={{ available: (d) => !unavailable(d) }}
          modifiersClassNames={{
            // aria-selected wins on specificity, so a picked day keeps the primary fill.
            available: "text-success font-semibold aria-selected:text-primary-foreground",
          }}
          className="mx-auto w-fit"
        />
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-2 pb-2">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-success" aria-hidden />
            {dateFirst ? "Ada dokter praktik" : "Dokter praktik"}
          </span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-muted-foreground/40" aria-hidden />
            Tidak ada jadwal / penuh
          </span>
          {!dayInfo && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
              Memeriksa ketersediaan…
            </span>
          )}
        </div>
      </div>

      {/* Nothing follows the calendar on the antrean path: the jam belongs to the doctor step
          there, so a date heading with a line of instructions under it would be a stub
          restating what the highlighted day already says. */}
      {data.visitDate && (!dateFirst || hourFirst) && (
        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">
            {format(selectedDate!, "EEEE, d MMMM yyyy", { locale: localeId })}
          </p>
          <SlotList
            slug={slug}
            specializationId={data.specializationId!}
            doctorId={hourFirst ? undefined : data.doctorId!}
            date={data.visitDate}
            timeDisplay={timeDisplay}
            data={data}
            update={update}
          />
        </div>
      )}
    </div>
  );
}
