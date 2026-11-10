import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet } from "@/lib/api";
import PromoShell, { rupiah } from "./PromoShell";

interface Voucher {
  status: "PENDING" | "PAID" | "EXPIRED";
  first_name: string;
  masked_name: string;
  nik_tail: string;
  voucher_code: string | null;
  invoice_number: string;
  amount: number;
  payment_url: string | null;
  redeemed: boolean;
  product_label: string;
  visit_period: string;
  campaign_id: string;
}

const card = "flex flex-col rounded-3xl border border-[#E6EAF2] bg-white";

export default function VoucherPage() {
  const { token = "" } = useParams();
  const [v, setV] = useState<Voucher | null>(null);
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    try {
      setV(await apiGet<Voucher>(`/api/promo/voucher/${token}`));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // While unpaid, keep asking (the server polls DOKU on each read) for ~10 minutes.
  useEffect(() => {
    if (v?.status !== "PENDING") return;
    let n = 0;
    const t = setInterval(() => {
      if (++n > 120) return clearInterval(t);
      load();
    }, 5000);
    return () => clearInterval(t);
  }, [v?.status, load]);

  if (err) return <PromoShell><p className="p-6 text-base">{err}</p></PromoShell>;
  if (!v) return <PromoShell><p className="p-6 text-base text-[#5B6478]">Memuat voucher…</p></PromoShell>;

  if (v.status !== "PAID") {
    const pending = v.status === "PENDING";
    return (
      <PromoShell>
        <div className="flex flex-col gap-4 bg-[#F4F6FA] px-4 py-5">
          <section className={`${card} gap-3 px-5 py-6`}>
            <h1 className="m-0 text-2xl font-extrabold">{pending ? "Menunggu pembayaran" : "Pembayaran kedaluwarsa"}</h1>
            <p className="m-0 text-base leading-relaxed text-[#3B4458]">
              {pending
                ? "Selesaikan pembayaran di DOKU. Halaman ini otomatis berubah jadi voucher begitu pembayaran kami terima."
                : "Batas waktu pembayaran sudah lewat dan voucher tidak terbit. Kamu bisa memesan lagi selama promo masih berlaku."}
            </p>
            <span className="text-[13px] text-[#5B6478]">No. pesanan {v.invoice_number}</span>
            {pending && v.payment_url && (
              <a href={v.payment_url} className="flex h-12 items-center justify-center rounded-lg bg-[#0033FF] text-base font-bold text-white no-underline">
                Lanjutkan pembayaran
              </a>
            )}
            {pending ? (
              <button type="button" onClick={load} disabled={checking} className="h-12 rounded-lg border border-[#0033FF] bg-white text-base font-bold text-[#0033FF]">
                {checking ? "Mengecek…" : "Saya sudah bayar, cek lagi"}
              </button>
            ) : (
              <a href={`/${v.campaign_id}`} className="flex h-12 items-center justify-center rounded-lg border border-[#0033FF] text-base font-bold text-[#0033FF] no-underline">
                Kembali ke halaman promo
              </a>
            )}
          </section>
        </div>
      </PromoShell>
    );
  }

  return (
    <PromoShell>
      <div className="flex flex-col gap-4 bg-[#F4F6FA] px-4 py-5">
        <section className={`${card} gap-4 px-5 py-6`}>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-[#5B6478]">Voucher Flash Sale 11.11</span>
            <h1 className="m-0 text-[28px] font-extrabold">Halo, {v.first_name}!</h1>
            <p className="m-0 text-base leading-normal text-[#3B4458]">
              {v.redeemed ? "Voucher ini sudah dipakai. Terima kasih sudah vaksin di Klinik Adera." : "Pembayaran kamu sudah kami terima. Simpan halaman ini dan tunjukkan saat datang."}
            </p>
          </div>
          <dl className="m-0 flex flex-col gap-3.5">
            <div><dt className="text-sm text-[#5B6478]">Vaksin</dt><dd className="m-0 text-base font-semibold">{v.product_label.replace(/^Vaksin /, "")} × 1</dd></div>
            <div><dt className="text-sm text-[#5B6478]">Datang kapan saja</dt><dd className="m-0 text-base font-semibold">{v.visit_period}</dd></div>
            <div><dt className="text-sm text-[#5B6478]">Lokasi</dt><dd className="m-0 text-base font-semibold">Klinik Pratama Adera, Sleman</dd></div>
          </dl>
          <div className="rounded-xl bg-[#EEF1F7] px-4 py-3.5 text-[15px] leading-normal text-[#3B4458]">
            Bawa <strong className="text-[#0F2557]">KTP asli</strong> sesuai NIK. Tunjukkan kode di bawah ke petugas pendaftaran.
          </div>
          <span className="text-[13px] text-[#5B6478]">No. pesanan {v.invoice_number}</span>
        </section>

        <section className={`${card} items-center gap-3.5 px-5 py-6`}>
          <h2 className="m-0 text-center text-[22px] font-extrabold">Tunjukkan kode ini di meja pendaftaran</h2>
          <div className="rounded-xl border border-[#E6EAF2] p-3">
            <img src={`/api/promo/voucher/${token}/qr.svg`} alt={`QR kode voucher ${v.voucher_code}`} width={180} height={180} />
          </div>
          <span className="text-[13px] font-semibold tracking-[0.08em] text-[#5B6478]">KODE VOUCHER</span>
          <span className="text-4xl font-extrabold tracking-[0.12em] tabular-nums">{v.voucher_code}</span>
          <span className="text-center text-sm text-[#5B6478]">Atas nama {v.masked_name} · NIK …{v.nik_tail}</span>
        </section>

        <section className={`${card} gap-2.5 px-5 py-[18px] text-[15px]`}>
          <h2 className="m-0 mb-1 text-lg font-extrabold">Ringkasan transaksi</h2>
          <div className="flex justify-between"><span>Vaxigrip TIV × 1</span><span>{rupiah(v.amount)}</span></div>
          <div className="flex justify-between"><span>Biaya admin &amp; BHP</span><span className="font-bold text-[#15803D]">Gratis</span></div>
          <div className="flex justify-between font-extrabold"><span>Lunas · DOKU</span><span>{rupiah(v.amount)}</span></div>
        </section>
      </div>
    </PromoShell>
  );
}
