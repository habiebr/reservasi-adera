// "Cek Antrean" — the way back in for a patient who no longer has the confirmation link.
// Identity is NIK + tanggal lahir, matching how the wizard's own lookup identifies people;
// the server treats the birth date as a second factor, so a NIK alone finds nothing.
import { useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Search, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DateSegments from "@/components/wizard/DateSegments";
import SiteChrome from "@/components/SiteChrome";
import { apiPost } from "@/lib/api";

interface Visit {
  visit_date: string;
  slot_time: string | null;
  booking_order_type: string | null;
  booking_status: string | null;
  payment_status: string | null;
  doctor_name: string | null;
  specialization_name: string | null;
  polyclinic_name: string | null;
  booking_code: string | null;
  queue_number: string | null;
  queue_status: string | null;
  registered: boolean;
}
interface Result {
  found: boolean;
  masked_name?: string;
  visits?: Visit[];
}

const tanggal = (d: string) => {
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime())
    ? d
    : format(parsed, "EEEE, d MMMM yyyy", { locale: localeId });
};

export default function QueueCheck() {
  const [nik, setNik] = useState("");
  const [dob, setDob] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const ready = /^\d{16}$/.test(nik) && /^\d{4}-\d{2}-\d{2}$/.test(dob);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await apiPost<Result>("/api/booking/antrean", { nik, tanggal_lahir: dob }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memeriksa antrean.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SiteChrome
      title="Cek Nomor Antrean"
      subtitle="Masukkan NIK dan tanggal lahir yang Anda pakai saat reservasi."
      stats={[]}
      showQueueLink={false}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="nik">NIK</Label>
          <Input
            id="nik"
            inputMode="numeric"
            autoComplete="off"
            maxLength={16}
            placeholder="16 digit NIK"
            value={nik}
            onChange={(e) => setNik(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Tanggal Lahir</Label>
          <DateSegments value={dob} onChange={setDob} />
        </div>
        <Button type="submit" disabled={!ready || busy} className="w-full">
          <Search className="mr-2 h-4 w-4" />
          {busy ? "Mencari…" : "Cek Antrean"}
        </Button>
      </form>

      {error && (
        <p className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      )}

      {result && !result.found && (
        <p className="mt-4 rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">
          Tidak ada reservasi mendatang atas NIK dan tanggal lahir tersebut. Periksa lagi
          keduanya, atau hubungi klinik lewat nomor di bagian atas halaman.
        </p>
      )}

      {result?.found && (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Reservasi atas nama <span className="font-semibold">{result.masked_name}</span>
          </p>

          {result.visits?.map((v, i) => (
            <article key={i} className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">{tanggal(v.visit_date)}</p>
              <p className="text-xs text-muted-foreground">
                {v.polyclinic_name ?? v.specialization_name ?? "-"}
                {v.doctor_name ? ` · ${v.doctor_name}` : ""}
                {v.slot_time ? ` · ${v.slot_time}` : ""}
              </p>

              {v.queue_number ? (
                <div className="mt-3 flex items-center justify-center gap-6 rounded-lg bg-primary p-3 text-primary-foreground">
                  {v.booking_code && (
                    <div className="text-center">
                      <p className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide opacity-80">
                        <Ticket className="h-3 w-3" /> Kode Booking
                      </p>
                      <p className="font-mono text-lg font-bold">{v.booking_code}</p>
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-[11px] uppercase tracking-wide opacity-80">No. Antrean</p>
                    <p className="font-mono text-2xl font-bold">{v.queue_number}</p>
                  </div>
                </div>
              ) : (
                // No number is the normal case for an EXACT_TIME poli, and the temporary case
                // for a queue poli whose EMR registration has not landed yet. Say which.
                <p className="mt-3 rounded-lg bg-info/5 p-3 text-xs text-muted-foreground">
                  {v.booking_order_type === "EXACT_TIME"
                    ? "Poli ini memakai jam janji, jadi tidak memakai nomor antrean. Datanglah sesuai jam di atas."
                    : v.payment_status === "PAID"
                      ? "Nomor antrean belum terbit. Muat ulang halaman ini sebentar lagi."
                      : "Nomor antrean terbit setelah pembayaran diterima."}
                </p>
              )}

              {v.queue_status === "CHECKED_IN" && (
                <p className="mt-2 text-center text-xs font-medium text-success">
                  Sudah check-in di klinik.
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </SiteChrome>
  );
}
