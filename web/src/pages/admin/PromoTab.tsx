import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { formatRupiah } from "@shared/pricing";

const CAMPAIGN = "11-11";

interface Order {
  invoice_number: string;
  nama: string;
  nik: string;
  phone: string;
  email: string | null;
  status: string;
  amount: number;
  paid_at: string | null;
  voucher_code: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  redeemed_at: string | null;
  calq_mrn: string | null;
  calq_invoice_no: string | null;
  calq_paid_at: string | null;
  redeem_error: string | null;
  dob?: string;
  sex?: string;
}
interface Campaign {
  id: string;
  title: string;
  product_label: string;
  calq_product_id: number | null;
  price_normal: number;
  price_promo: number;
  sale_starts: string;
  sale_ends: string;
  redeem_until: string;
  active: boolean;
  state: string;
}
interface ListResp {
  campaign: Campaign;
  stats: { sold: string; redeemed: string; revenue: string };
  orders: Order[];
}
interface Lookup {
  order: Order;
  calq: { found: boolean; mrn?: string | null; dob_match?: boolean } | null;
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "—";

function statusOf(o: Order): { label: string; cls: string } {
  if (o.status === "PENDING") return { label: "Belum bayar", cls: "bg-yellow-100 text-yellow-900" };
  if (o.calq_paid_at) return { label: "Ditukar", cls: "bg-slate-200 text-slate-800" };
  if (o.redeem_error) return { label: "Gagal Calq · ulangi", cls: "bg-red-100 text-red-800" };
  return { label: "Siap ditukar", cls: "bg-green-100 text-green-800" };
}

export default function PromoTab() {
  const [data, setData] = useState<ListResp | null>(null);
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCodes, setShowCodes] = useState(false);
  const [productId, setProductId] = useState("");

  const reload = useCallback(async () => {
    const d = await apiGet<ListResp>(`/api/admin/promo/${CAMPAIGN}/vouchers`);
    setData(d);
    setProductId(d.campaign.calq_product_id ? String(d.campaign.calq_product_id) : "");
  }, []);
  useEffect(() => {
    reload().catch((e) => setMsg({ ok: false, text: e.message }));
  }, [reload]);

  async function find(e?: FormEvent) {
    e?.preventDefault();
    setMsg(null);
    setLookup(null);
    try {
      setLookup(await apiGet<Lookup>(`/api/admin/promo/voucher/${code.replace(/\D/g, "")}`));
    } catch (ex) {
      setMsg({ ok: false, text: (ex as Error).message });
    }
  }

  async function redeem() {
    if (!lookup) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiPost<{ ok: boolean; message: string }>(
        `/api/admin/promo/voucher/${lookup.order.voucher_code}/redeem`,
      );
      setMsg({ ok: r.ok, text: r.message });
    } catch (ex) {
      setMsg({ ok: false, text: (ex as Error).message });
    } finally {
      setBusy(false);
      await find();
      await reload();
    }
  }

  async function saveProduct() {
    try {
      await apiPut(`/api/admin/promo/${CAMPAIGN}`, { calq_product_id: productId || null });
      setMsg({ ok: true, text: "Produk Calq disimpan." });
      await reload();
    } catch (ex) {
      setMsg({ ok: false, text: (ex as Error).message });
    }
  }

  async function toggleActive() {
    if (!data) return;
    await apiPut(`/api/admin/promo/${CAMPAIGN}`, { active: !data.campaign.active });
    await reload();
  }

  const o = lookup?.order;
  const st = o ? statusOf(o) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-h3">Voucher promo · {data?.campaign.title ?? "…"}</h2>
          <p className="text-sm text-muted-foreground">
            {data?.campaign.product_label} · {data ? formatRupiah(data.campaign.price_promo) : ""} · status penjualan:{" "}
            <strong>{data?.campaign.state}</strong>. Calq baru ditulis saat tombol Tukarkan ditekan.
          </p>
        </div>
        {data && (
          <div className="flex gap-4 text-sm">
            <span>Terjual <strong>{data.stats.sold}</strong></span>
            <span>Ditukar <strong>{data.stats.redeemed}</strong></span>
            <span>Masuk <strong>{formatRupiah(Number(data.stats.revenue))}</strong></span>
          </div>
        )}
      </div>

      {msg && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {msg.text}
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
          <form onSubmit={find} className="flex flex-col gap-2">
            <Label htmlFor="vcode">Kode voucher</Label>
            <div className="flex gap-2">
              <Input id="vcode" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="8 digit" className="h-12 text-xl tracking-widest" />
              <Button type="submit" variant="outline" className="h-12">Cari</Button>
            </div>
          </form>
          {o && st && (
            <>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold">{o.nama}</h3>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>{st.label}</span>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">NIK</dt><dd className="font-semibold">{o.nik}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Tanggal lahir</dt><dd className="font-semibold">{o.dob ? new Date(o.dob).toLocaleDateString("id-ID") : "—"} · {o.sex === "FEMALE" ? "P" : "L"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">WhatsApp</dt><dd className="font-semibold">{o.phone}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Dibayar</dt><dd className="font-semibold">{fmt(o.paid_at)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Jumlah</dt><dd className="font-semibold">{formatRupiah(o.amount)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">No. pesanan</dt><dd className="font-semibold">{o.invoice_number}</dd></div>
              </dl>
              <p className="rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-900">Cocokkan nama dan NIK dengan KTP pasien sebelum menukar.</p>
            </>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
          <h3 className="text-lg font-bold">Kirim ke Calq</h3>
          {!o ? (
            <p className="text-sm text-muted-foreground">Cari kode voucher dulu.</p>
          ) : (
            <>
              <div className="rounded-lg border px-3 py-2 text-sm">
                {o.calq_mrn
                  ? <>Pasien Calq <strong>{o.calq_mrn}</strong></>
                  : lookup?.calq?.found
                  ? <>Ditemukan lewat NIK · <strong>{lookup.calq.mrn}</strong>{lookup.calq.dob_match === false && " · tanggal lahir beda, cek dulu"}</>
                  : "Belum ada di Calq — pasien baru dibuat dari data voucher."}
              </div>
              <div className="rounded-lg border px-3 py-2 text-sm">
                Produk Calq #{data?.campaign.calq_product_id ?? "belum diatur"} × 1 · {formatRupiah(o.amount)} · pembayaran DOKU (lunas online), tanpa biaya admin &amp; BHP
              </div>
              {o.redeem_error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{o.redeem_error}</p>}
              {o.calq_paid_at ? (
                <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                  Ditukar {fmt(o.calq_paid_at)} · invoice Calq {o.calq_invoice_no ?? "—"}
                </p>
              ) : (
                <Button onClick={redeem} disabled={busy || o.status !== "PAID"} className="h-12 text-base">
                  {busy ? "Mengirim ke Calq…" : o.redeem_error ? "Ulangi kirim ke Calq" : "Tukarkan & kirim ke Calq"}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">Urutan: pasien → invoice (sale) → pembayaran. Gagal di satu langkah? Ulangi melanjutkan dari langkah itu, tanpa duplikat.</p>
            </>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold">Semua voucher</h3>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={showCodes} onChange={(e) => setShowCodes(e.target.checked)} /> Tampilkan kode</label>
            <Button variant="outline" size="sm" onClick={() => reload()}>Muat ulang</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="p-2">Kode</th><th className="p-2">Nama</th><th className="p-2">NIK</th><th className="p-2">WhatsApp</th><th className="p-2">Dibayar</th><th className="p-2">Email</th><th className="p-2">Status</th><th className="p-2">Invoice Calq</th>
            </tr></thead>
            <tbody>
              {(data?.orders ?? []).map((r) => {
                const s = statusOf(r);
                return (
                  <tr key={r.invoice_number} className="border-b last:border-0">
                    <td className="p-2 tabular-nums">{r.voucher_code ? (showCodes ? r.voucher_code : "•••• " + r.voucher_code.slice(-4)) : "—"}</td>
                    <td className="p-2">{r.nama}</td>
                    <td className="p-2">…{r.nik.slice(-4)}</td>
                    <td className="p-2">{r.phone}</td>
                    <td className="p-2">{fmt(r.paid_at)}</td>
                    <td className="p-2">{r.email ? (r.email_sent_at ? "terkirim" : r.email_error ? "gagal" : "menunggu") : "—"}</td>
                    <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span></td>
                    <td className="p-2 tabular-nums">{r.calq_invoice_no ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        <h3 className="text-lg font-bold">Pengaturan promo</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pid">ID produk Calq (Vaxigrip TIV)</Label>
            <Input id="pid" inputMode="numeric" value={productId} onChange={(e) => setProductId(e.target.value.replace(/\D/g, ""))} className="w-48" />
          </div>
          <Button onClick={saveProduct}>Simpan</Button>
          <Button variant="outline" onClick={toggleActive}>{data?.campaign.active ? "Matikan promo" : "Aktifkan promo"}</Button>
        </div>
        {data && (
          <p className="text-xs text-muted-foreground">
            Penjualan {fmt(data.campaign.sale_starts)} – {fmt(data.campaign.sale_ends)} · tukar sampai {fmt(data.campaign.redeem_until)} · harga normal {formatRupiah(data.campaign.price_normal)}, promo {formatRupiah(data.campaign.price_promo)}
          </p>
        )}
      </section>
    </div>
  );
}
