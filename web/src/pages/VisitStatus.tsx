import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { CheckCircle2, Clock3, Mail, Ticket, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, type StatusResponse } from "@/lib/api";
import { formatRupiah } from "@shared/pricing";

export default function VisitStatus() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const invoice = params.get("invoice") ?? "";
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!invoice) return;
    let stopped = false;
    const poll = async () => {
      try {
        const r = await apiGet<StatusResponse>(`/api/booking/status?invoice=${invoice}`);
        if (stopped) return;
        setStatus(r);
        if (r.payment_status === "PENDING") setTimeout(poll, 5000);
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "Gagal memuat status.");
      }
    };
    poll();
    return () => {
      stopped = true;
    };
  }, [invoice]);

  return (
    <div className="min-h-screen bg-background">
      <header className="adera-hero-bg">
        <div className="mx-auto max-w-xl px-4 py-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Klinik Adera
          </p>
          <h1 className="mt-1 font-display text-2xl font-extrabold text-foreground">
            Status Reservasi
          </h1>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-16">
        <div className="-mt-2 rounded-2xl border border-border bg-card p-5 shadow-md sm:p-8">
          {error && <p className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
          {!status && !error && (
            <div className="space-y-4">
              <Skeleton className="h-10 w-2/3 rounded-lg" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
          )}
          {status && status.payment_status === "PENDING" && <Pending status={status} />}
          {status && status.payment_status === "PAID" && <Paid status={status} />}
          {status && status.payment_status === "EXPIRED" && <Expired slug={slug} />}
        </div>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function Pending({ status }: { status: StatusResponse }) {
  return (
    <div className="space-y-5 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning-muted">
        <Clock3 className="h-7 w-7 animate-pulse text-warning-foreground" />
      </span>
      <div>
        <h2 className="font-display text-lg font-bold text-foreground">Menunggu pembayaran</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Selesaikan pembayaran sebesar{" "}
          <b className="text-foreground">{formatRupiah(status.amount_due)}</b> sebelum batas waktu.
          Halaman ini memperbarui status secara otomatis.
        </p>
      </div>
      {status.payment_url && (
        <Button asChild className="h-11 w-full sm:w-auto sm:px-8">
          <a href={status.payment_url}>Buka Halaman Pembayaran</a>
        </Button>
      )}
      <p className="text-xs text-muted-foreground">Invoice: {status.invoice_number}</p>
    </div>
  );
}

function Paid({ status }: { status: StatusResponse }) {
  const tanggal = format(new Date(`${String(status.visit_date).slice(0, 10)}T12:00:00`), "EEEE, d MMMM yyyy", {
    locale: localeId,
  });
  const sisa = status.total_amount - status.amount_due;
  return (
    <div className="space-y-5">
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-7 w-7 text-success" />
        </span>
        <h2 className="mt-3 font-display text-lg font-bold text-foreground">
          Reservasi terkonfirmasi
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Terima kasih, {status.nama_lengkap ?? "Pasien"}. Pembayaran Anda sudah kami terima.
        </p>
      </div>

      {(status.booking_code || status.queue_number) && (
        <div className="flex items-center justify-center gap-6 rounded-xl bg-primary p-4 text-primary-foreground">
          {status.booking_code && (
            <div className="text-center">
              <p className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide opacity-80">
                <Ticket className="h-3 w-3" /> Kode Booking
              </p>
              <p className="font-mono text-xl font-bold">{status.booking_code}</p>
            </div>
          )}
          {status.queue_number && (
            <div className="text-center">
              <p className="text-[11px] uppercase tracking-wide opacity-80">No. Antrean</p>
              <p className="font-mono text-xl font-bold">{status.queue_number}</p>
            </div>
          )}
        </div>
      )}
      {!status.emr_ok && (
        <p className="rounded-lg bg-info/5 p-3 text-center text-xs text-muted-foreground">
          Pembayaran diterima — detail kunjungan (kode booking / nomor antrean) menyusul, muat
          ulang halaman ini sebentar lagi.
        </p>
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-bold text-foreground">Kunjungan</h3>
        <Row label="Poli" value={status.polyclinic_name ?? status.specialization_name ?? "-"} />
        <Row label="Dokter" value={status.doctor_name ?? "-"} />
        <Row label="Tanggal" value={tanggal} />
        <Row label="Jam" value={status.slot_time ?? "Sesuai antrean"} />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-bold text-foreground">Invoice</h3>
        {status.items.map((i, idx) => (
          <Row
            key={idx}
            label={`${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`}
            value={formatRupiah(i.unitPrice * i.quantity)}
          />
        ))}
        <div className="mt-2 border-t border-border pt-2">
          <Row label="Total" value={formatRupiah(status.total_amount)} />
          <Row
            label={status.jenis_pembayaran === "DP" ? "DP dibayar" : "Dibayar"}
            value={formatRupiah(status.amount_due)}
          />
          {sisa > 0 && <Row label="Sisa (di klinik)" value={formatRupiah(sisa)} />}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">No. {status.invoice_number}</p>
      </section>

      {status.email_masked && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Mail className="h-3.5 w-3.5" /> Invoice dikirim ke {status.email_masked}
        </p>
      )}
      <p className="rounded-lg bg-warning-muted p-3 text-center text-xs text-warning-foreground">
        Tunjukkan kode booking saat kedatangan dan bawa KTP asli.
      </p>
    </div>
  );
}

function Expired({ slug }: { slug: string }) {
  return (
    <div className="space-y-5 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <XCircle className="h-7 w-7 text-destructive" />
      </span>
      <div>
        <h2 className="font-display text-lg font-bold text-foreground">Pembayaran kedaluwarsa</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Batas waktu pembayaran terlewati dan slot Anda dilepas. Silakan buat reservasi baru.
        </p>
      </div>
      <Button asChild variant="outline" className="h-11">
        <a href={`/${slug}`}>Buat Reservasi Baru</a>
      </Button>
    </div>
  );
}
