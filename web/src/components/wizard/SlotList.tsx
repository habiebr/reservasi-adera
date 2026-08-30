// Jam / sesi praktik for one doctor on one date. Lives on its own because the block that
// renders it depends on the form's direction: doctor-first forms show it inside "Pilih
// Jadwal" (the doctor is already known), date-first forms show it inside "Pilih Dokter"
// (the date is already known). Calq only quotes slots once both are pinned down.
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
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

/** A merged slot brings its own doctor. Adopting it silently is the point: the patient chose
 * an hour, so `doctorImplicit` tells the rest of the wizard not to parade a name they never
 * picked. A single-doctor grid carries no doctor and leaves the choice untouched. */
function doctorOf(slot: { doctorId?: number | null; doctorName?: string | null }) {
  return slot.doctorId
    ? { doctorId: slot.doctorId, doctorName: slot.doctorName ?? "", doctorImplicit: true }
    : {};
}

export default function SlotList({
  slug,
  specializationId,
  doctorId,
  date,
  timeDisplay,
  data,
  update,
}: {
  slug: string;
  specializationId: number;
  /** Omitted for an hour-first poli: every doctor's slots arrive in one grid. */
  doctorId?: number;
  date: string;
  timeDisplay: "segmented" | "dropdown";
  data: BlockProps["data"];
  update: BlockProps["update"];
}) {
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setSlots(null);
    setError("");
    apiGet<SlotsResponse>(
      `/api/calq/slots?slug=${slug}&specializationId=${specializationId}&date=${date}` +
        (doctorId ? `&doctorId=${doctorId}` : ""),
    )
      .then(setSlots)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug, specializationId, doctorId, date]);

  return (
    <div>
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
          if (slot) update({ slotTime: v, scheduleId: slot.scheduleId, ...doctorOf(slot) });
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
            onClick={() =>
              update({ slotTime: s.startTime, scheduleId: s.scheduleId, ...doctorOf(s) })}
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
              update({
                scheduleId: s.scheduleId,
                slotTime: null,
                sessionLabel: label,
                ...doctorOf(s),
              })}
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
            <span className="text-sm font-semibold text-foreground">
              Sesi praktik {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
