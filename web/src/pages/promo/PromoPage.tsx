import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiGet, apiPost } from "@/lib/api";
import PromoShell, { rupiah } from "./PromoShell";

interface Campaign {
  id: string;
  product_label: string;
  price_normal: number;
  price_promo: number;
  sale_starts: string;
  sale_ends: string;
  visit_period: string;
  state: "upcoming" | "open" | "closed";
  now: string;
}

const input =
  "h-12 w-full rounded-lg border border-[#C9D1E0] px-3.5 text-base outline-none focus:border-[#0033FF] focus:ring-2 focus:ring-[#0033FF]/20";
const label = "text-sm font-bold";

function useCountdown(c: Campaign | null) {
  const [now, setNow] = useState(() => Date.now());
  const skew = useMemo(() => (c ? new Date(c.now).getTime() - Date.now() : 0), [c]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!c) return null;
  const t = now + skew;
  const start = new Date(c.sale_starts).getTime();
  const end = new Date(c.sale_ends).getTime();
  let phase: "upcoming" | "open" | "closed" = c.state;
  if (c.state !== "closed") phase = t < start ? "upcoming" : t < end ? "open" : "closed";
  const target = phase === "upcoming" ? start : end;
  const left = Math.max(0, Math.floor((target - t) / 1000));
  const hh = String(Math.floor(left / 3600)).padStart(2, "0");
  const mm = String(Math.floor((left % 3600) / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return { phase, clock: `${hh}:${mm}:${ss}` };
}

export default function PromoPage({ id }: { id: string }) {
  const [c, setC] = useState<Campaign | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [f, setF] = useState({ nama: "", nik: "", dob: "", sex: "", phone: "", email: "", consent: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cd = useCountdown(c);

  useEffect(() => {
    apiGet<Campaign>(`/api/promo/${id}`).then(setC).catch((e) => setLoadErr(String(e.message ?? e)));
  }, [id]);

  const set = (k: keyof typeof f) => (v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await apiPost<{ payment_url: string }>(`/api/promo/${id}/order`, f);
      window.location.href = r.payment_url;
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy(false);
    }
  }

  if (loadErr) return <PromoShell><p className="p-6 text-base">{loadErr}</p></PromoShell>;
  if (!c || !cd) return <PromoShell><p className="p-6 text-base text-[#5B6478]">Memuat…</p></PromoShell>;
  const open = cd.phase === "open";

  return (
    <PromoShell>
      <section className="relative text-white">
        <img src="/promo/1111-hero-mobile.webp" alt="Flash Sale 11.11 Vaksin Adera: vaksin makin hemat, khusus 11 November 2026" className="block aspect-[1080/1350] w-full object-cover" />
        <div className="absolute inset-x-4 bottom-5 flex flex-col gap-3.5">
          <h1 className="sr-only">Flash Sale 11.11: vaksin influenza Vaxigrip TIV di Klinik Adera</h1>
          <div className="flex flex-col gap-0.5 rounded-2xl bg-white px-5 py-3.5 text-[#0F2557]">
            <span className="text-[15px] font-semibold">
              {cd.phase === "upcoming" ? "Promo dimulai dalam" : cd.phase === "open" ? "Promo berakhir dalam" : "Promo telah berakhir"}
            </span>
            {cd.phase !== "closed" && (
              <span className="text-[28px] font-extrabold tabular-nums text-[#B0124F]">{cd.clock}</span>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4 px-4 pb-2 pt-7">
        <p className="m-0 text-xl font-extrabold leading-snug text-[#0033FF]">Perlindungan untuk influenza A dengan harga spesial 11.11!</p>
        <p className="m-0 text-base leading-[1.7] text-[#3B4458]">
          Di musim hujan, flu lebih gampang menular, dan sekali kena kamu bisa harus istirahat beberapa hari.
          Vaxigrip TIV melindungi dari tiga strain influenza yang diperkirakan beredar musim ini: A H1N1, A H3N2,
          dan B Victoria, sesuai rekomendasi terbaru WHO untuk vaksin flu musiman.
        </p>
        <div className="flex flex-col gap-0.5 rounded-xl border border-[#E6EAF2] p-4 shadow-sm">
          <span className="text-base font-bold">{c.product_label}</span>
          <span className="text-[26px] font-extrabold text-[#0033FF]">
            {rupiah(c.price_promo)} <span className="text-sm font-medium text-[#5B6478]">per dosis</span>
          </span>
          <span className="text-[13px] text-[#5B6478]">Harga normal <s>{rupiah(c.price_normal)}</s></span>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-base font-semibold">
          <li>✓ Hemat {rupiah(c.price_normal - c.price_promo)} dari harga normal</li>
          <li>✓ Gratis biaya admin dan BHP</li>
        </ul>
      </section>

      <section className="px-4 pb-4 pt-6">
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-[#E6EAF2] px-4 py-5 shadow-md">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-xl font-extrabold">Data penerima vaksin</h2>
            <p className="m-0 text-sm text-[#5B6478]">Isi sesuai KTP orang yang akan disuntik.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nama" className={label}>Nama lengkap</label>
            <input id="nama" className={input} placeholder="Sesuai KTP" autoComplete="name" value={f.nama} onChange={(e) => set("nama")(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nik" className={label}>NIK</label>
            <input id="nik" className={input} inputMode="numeric" maxLength={16} placeholder="16 digit" value={f.nik} onChange={(e) => set("nik")(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="dob" className={label}>Tanggal lahir</label>
              <input id="dob" type="date" className={input} value={f.dob} onChange={(e) => set("dob")(e.target.value)} required />
            </div>
            <fieldset className="m-0 flex flex-col border-0 p-0">
              <legend className={`${label} mb-1.5 p-0`}>Jenis kelamin</legend>
              <div className="flex gap-2">
                {([["FEMALE", "P"], ["MALE", "L"]] as const).map(([v, t]) => (
                  <label key={v} className={`flex h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-[15px] ${f.sex === v ? "border-2 border-[#0033FF] bg-[#E6ECFF] font-bold text-[#0033FF]" : "border border-[#C9D1E0]"}`}>
                    <input type="radio" name="sex" value={v} checked={f.sex === v} onChange={() => set("sex")(v)} className="m-0" required /> {t}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wa" className={label}>No. WhatsApp</label>
            <input id="wa" className={input} inputMode="tel" autoComplete="tel" placeholder="08xx xxxx xxxx" value={f.phone} onChange={(e) => set("phone")(e.target.value)} required />
            <span className="text-[13px] text-[#5B6478]">Kode voucher dikirim ke WhatsApp ini.</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className={label}>Email <span className="font-medium text-[#5B6478]">(salinan voucher)</span></label>
            <input id="email" type="email" className={input} autoComplete="email" placeholder="nama@email.com" value={f.email} onChange={(e) => set("email")(e.target.value)} />
          </div>
          <label className="flex items-start gap-2.5 text-[13px] leading-normal text-[#3B4458]">
            <input type="checkbox" className="mt-0.5 h-[18px] w-[18px] flex-none" checked={f.consent} onChange={(e) => set("consent")(e.target.checked)} />
            <span>Saya setuju data ini dipakai untuk pendaftaran di Klinik Pratama Adera dan sudah membaca <a href="#ketentuan" className="text-[#0033FF]">ketentuan</a>.</span>
          </label>
          <div className="flex flex-col gap-2 rounded-xl bg-[#F4F6FA] p-3.5 text-sm">
            <div className="flex justify-between"><span>Vaxigrip TIV × 1</span><span><s className="text-[#5B6478]">{rupiah(c.price_normal)}</s> {rupiah(c.price_promo)}</span></div>
            <div className="flex justify-between"><span>Biaya admin &amp; BHP</span><span className="font-bold text-[#15803D]">Gratis</span></div>
            <div className="h-px bg-[#E6EAF2]" />
            <div className="flex justify-between text-[17px] font-extrabold"><span>Total bayar</span><span className="text-[#0033FF]">{rupiah(c.price_promo)}</span></div>
          </div>
          {err && <p role="alert" className="m-0 rounded-lg bg-[#FEE2E2] px-3 py-2 text-sm text-[#991B1B]">{err}</p>}
          <button type="submit" disabled={!open || busy} className="h-[52px] rounded-lg border-0 bg-[#0033FF] text-[17px] font-bold text-white disabled:cursor-not-allowed disabled:bg-[#94A3B8]">
            {busy ? "Membuka pembayaran…" : open ? `Bayar ${rupiah(c.price_promo)}` : cd.phase === "upcoming" ? "Dibuka 11 November, 00.00 WIB" : "Promo telah berakhir"}
          </button>
        </form>
        <a href="https://wa.me/6281180008812" className="mt-3.5 flex h-12 items-center justify-center rounded-lg border border-[#0033FF] text-[15px] font-bold text-[#0033FF] no-underline">
          Tanya dulu lewat WhatsApp
        </a>
      </section>

      <section id="ketentuan" className="px-4 pb-8 pt-2">
        <div className="flex flex-col gap-2 rounded-xl border border-[#F3DFA8] bg-[#FFF8E6] px-[18px] py-4 text-[#7A3E00]">
          <strong className="text-base">Ketentuan</strong>
          <ul className="m-0 flex flex-col gap-1.5 pl-5 text-[15px] leading-[1.55]">
            <li>Pembelian voucher hanya tanggal 11 November 2026.</li>
            <li>Jadwal suntik bisa kamu pilih antara 11 dan 18 November 2026, datang pada jam praktik.</li>
            <li>Berlaku di Klinik Pratama Adera, Sleman.</li>
            <li>Satu voucher untuk satu orang, sesuai NIK.</li>
            <li>Vaksinasi didahului pemeriksaan singkat oleh dokter.</li>
          </ul>
        </div>
      </section>
    </PromoShell>
  );
}
