import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { CalendarDays, Users } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, type SlotsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { BlockProps } from "./types";

const fmtDate = (d: Date) => format(d, "yyyy-MM-dd");

export default function SchedulePicker({ slug, block, data, update }: BlockProps) {
  const maxDaysAhead = block.config.maxDaysAhead ?? 30;
  const timeDisplay = block.config.timeDisplay ?? "segmented";
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const practiceDays = useMemo(() => new Set(data.practiceDays ?? []), [data.practiceDays]);
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const maxDate = useMemo(
    () => new Date(today.getTime() + maxDaysAhead * 86_400_000),
    [today, maxDaysAhead],
  );

  useEffect(() => {
    if (!data.visitDate || !data.specializationId || !data.doctorId) return;
    setLoading(true);
    setSlots(null);
    setError("");
    apiGet<SlotsResponse>(
      `/api/calq/slots?slug=${slug}&specializationId=${data.specializationId}&doctorId=${data.doctorId}&date=${data.visitDate}`,
    )
      .then(setSlots)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug, data.visitDate, data.specializationId, data.doctorId]);

  if (!data.doctorId) {
    return <p className="text-sm text-muted-foreground">Pilih dokter terlebih dahulu.</p>;
  }

  const selectedDate = data.visitDate ? new Date(`${data.visitDate}T12:00:00`) : undefined;

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
            update({ visitDate: fmtDate(d), scheduleId: undefined, slotTime: undefined });
          }}
          disabled={(d) =>
            d < today || d > maxDate || (practiceDays.size > 0 && !practiceDays.has(d.getDay()))}
          className="mx-auto"
        />
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          Tanggal yang bisa dipilih mengikuti hari praktik dokter, maksimal {maxDaysAhead} hari ke
          depan.
        </p>
      </div>

      {data.visitDate && (
        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">
            {format(selectedDate!, "EEEE, d MMMM yyyy", { locale: localeId })}
          </p>
          {loading && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-11 rounded-lg" />)}
            </div>
          )}
          {error && (
            <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
          )}
          {slots && slots.bookingOrderType === "EXACT_TIME" && (
            <TimeSlotPicker slots={slots} display={timeDisplay} data={data} update={update} />
          )}
          {slots && slots.bookingOrderType !== "EXACT_TIME" && (
            <QueueSessions slots={slots} data={data} update={update} />
          )}
        </div>
      )}
    </div>
  );
}

function TimeSlotPicker({
  slots,
  display,
  data,
  update,
}: {
  slots: SlotsResponse;
  display: "segmented" | "dropdown";
  data: BlockProps["data"];
  update: BlockProps["update"];
}) {
  const available = slots.timeSlots.filter((s) => s.available);
  if (slots.timeSlots.length === 0) {
    return (
      <p className="rounded-lg bg-warning-muted p-3 text-sm text-warning-foreground">
        Tidak ada jadwal praktik pada tanggal ini.
      </p>
    );
  }
  if (available.length === 0) {
    return (
      <p className="rounded-lg bg-warning-muted p-3 text-sm text-warning-foreground">
        Semua jam pada tanggal ini sudah penuh — silakan pilih tanggal lain.
      </p>
    );
  }

  if (display === "dropdown") {
    return (
      <Select
        value={data.slotTime ?? ""}
        onValueChange={(v) => {
          const slot = slots.timeSlots.find((s) => s.startTime === v);
          if (slot) update({ slotTime: v, scheduleId: slot.scheduleId });
        }}
      >
        <SelectTrigger className="h-11 w-full sm:w-64">
          <SelectValue placeholder="Pilih jam kunjungan" />
        </SelectTrigger>
        <SelectContent>
          {available.map((s) => (
            <SelectItem key={`${s.scheduleId}-${s.startTime}`} value={s.startTime}>
              {s.startTime} – {s.endTime}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div role="radiogroup" aria-label="Pilihan jam" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {slots.timeSlots.map((s) => {
        const selected = data.slotTime === s.startTime && data.scheduleId === s.scheduleId;
        return (
          <button
            key={`${s.scheduleId}-${s.startTime}`}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!s.available}
            onClick={() => update({ slotTime: s.startTime, scheduleId: s.scheduleId })}
            className={cn(
              "flex h-11 items-center justify-center rounded-lg border-2 text-sm font-medium tabular-nums transition-all",
              !s.available
                ? "cursor-not-allowed border-border bg-muted text-muted-foreground line-through opacity-60"
                : selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-primary/60",
            )}
          >
            {s.startTime}
          </button>
        );
      })}
    </div>
  );
}

function QueueSessions({
  slots,
  data,
  update,
}: {
  slots: SlotsResponse;
  data: BlockProps["data"];
  update: BlockProps["update"];
}) {
  if (slots.sessions.length === 0) {
    return (
      <p className="rounded-lg bg-warning-muted p-3 text-sm text-warning-foreground">
        Tidak ada sesi praktik pada tanggal ini.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {slots.sessions.map((s) => {
        const selected = data.scheduleId === s.scheduleId;
        const label = `${s.startTime} – ${s.endTime}`;
        return (
          <button
            key={s.scheduleId}
            type="button"
            onClick={() =>
              update({ scheduleId: s.scheduleId, slotTime: null, sessionLabel: label })}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition-all",
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
              <Users className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-foreground">
                Sesi praktik {label}
              </span>
              <span className="block text-xs text-muted-foreground">
                Nomor antrean diberikan setelah pembayaran.
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
