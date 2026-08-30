// Data Calq: a clean read-only browser over everything the app can fetch from the EMR —
// poli/spesialisasi, dokter + jadwal, tindakan, obat & produk, vaksin, ruangan, metode bayar.
// Data is managed in Calq itself; this page only mirrors it (searchable, tabular).
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiGet } from "@/lib/api";
import { formatRupiah } from "@shared/pricing";
import { cn } from "@/lib/utils";

interface CalqPoli {
  id: number;
  name: string;
  specializations: { id: number; name: string; bookingOrderType: string }[];
}
interface CalqDoctor {
  id: number;
  name: string;
  sessionDuration: number;
  bookingOrderType: string;
  schedules: { dayOfWeek: number; startTime: string; endTime: string }[];
}
interface CalqProcedure {
  id: number;
  name: string;
  price: number;
  specializationId: number;
  isDownPayment: boolean;
  downPaymentAmount: number;
}
interface CalqProduct {
  id: number;
  name: string;
  type: string | null;
  genericName: string | null;
  manufacturer: string | null;
  sku: string | null;
  form: string | null;
  dosage: string | null;
  price: number;
}
interface CalqVaccine {
  id: number;
  name: string;
  type: string | null;
  frequency: number | null;
  ageRange: string | null;
  procedureId: number | null;
}
interface CalqRoom {
  id: number;
  name: string;
  isActive: boolean;
}
interface CalqPaymentMethod {
  id: number;
  name: string;
  category: string | null;
  isActive: boolean;
}

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const SECTIONS = [
  { id: "poli", label: "Poli & Spesialisasi" },
  { id: "doctors", label: "Dokter & Jadwal" },
  { id: "procedures", label: "Tindakan" },
  { id: "products", label: "Obat & Produk" },
  { id: "vaccines", label: "Vaksin" },
  { id: "rooms", label: "Ruangan" },
  { id: "payments", label: "Metode Bayar" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export default function CalqBrowserTab() {
  const [section, setSection] = useState<SectionId>("poli");
  const [env, setEnv] = useState("");
  const [polis, setPolis] = useState<CalqPoli[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<{ env: string; polis: CalqPoli[] }>("/api/admin/calq/polis")
      .then((r) => {
        setPolis(r.polis);
        setEnv(r.env);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Calq tidak terjangkau."));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Data Calq</h2>
          <p className="text-sm text-muted-foreground">
            Cermin data master dari EMR Calq — hanya menampilkan; kelola datanya di Calq.
          </p>
        </div>
        {env && <span className="chip chip-info">env: {env}</span>}
      </div>

      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
              section === s.id
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "poli" && <PoliSection polis={polis} />}
      {section === "doctors" && <DoctorsSection polis={polis} />}
      {section === "procedures" && <ProceduresSection polis={polis} />}
      {section === "products" && <ProductsSection />}
      {section === "vaccines" && <VaccinesSection />}
      {section === "rooms" && <RoomsSection />}
      {section === "payments" && <PaymentsSection />}
    </div>
  );
}

// ── shared bits ──

function SearchBox({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative max-w-sm">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 pl-9 text-sm"
      />
    </div>
  );
}

function DataTable({ head, children, empty }: {
  head: string[];
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            {head.map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {children}
          {empty && (
            <tr>
              <td colSpan={head.length} className="px-4 py-6 text-center text-muted-foreground">
                Tidak ada data yang cocok.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const Td = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <td className={cn("px-4 py-2.5 text-foreground", className)}>{children}</td>
);

const Loading = () => <p className="p-4 text-sm text-muted-foreground">Memuat dari Calq…</p>;

const PAGE_SIZE = 25;

interface Paged<T> {
  rows: T[];
  page: number;
  totalPages: number;
  total: number;
  from: number;
  to: number;
  setPage: (p: number) => void;
}

/** Paging happens here, not upstream: Calq ignores ?limit and always returns the whole list
 *  ({status, data, message} — no cursor, no total), so there is nothing to page through at the
 *  API. We slice what we already hold, which also keeps search spanning every row rather than
 *  just the visible page. `resetKey` (the search term) sends you back to page 1 — without it a
 *  narrowed filter strands you on a page that no longer exists. */
function usePaged<T>(all: T[], resetKey: unknown): Paged<T> {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * PAGE_SIZE;
  return {
    rows: all.slice(start, start + PAGE_SIZE),
    page: current,
    totalPages,
    total: all.length,
    from: all.length ? start + 1 : 0,
    to: Math.min(start + PAGE_SIZE, all.length),
    setPage,
  };
}

const PagerBtn = (
  { disabled, onClick, children }: {
    disabled: boolean;
    onClick: () => void;
    children: React.ReactNode;
  },
) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
  >
    {children}
  </button>
);

/** Renders nothing when everything fits on one page, so short tables stay uncluttered. */
function Pager({ page, totalPages, total, from, to, setPage }: Paged<unknown>) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">
        Menampilkan <span className="tabular-nums">{from}–{to}</span> dari{" "}
        <span className="tabular-nums">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <PagerBtn disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</PagerBtn>
        <span className="px-2 text-xs tabular-nums text-muted-foreground">
          {page} / {totalPages}
        </span>
        <PagerBtn disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          Berikutnya
        </PagerBtn>
      </div>
    </div>
  );
}

function TypeChip({ exact }: { exact: boolean }) {
  return (
    <span className={cn("chip", exact ? "chip-info" : "chip-success")}>
      {exact ? "Perjanjian jam" : "Antrean"}
    </span>
  );
}

function useSpecNames(polis: CalqPoli[] | null) {
  return useMemo(() => {
    const m = new Map<number, string>();
    for (const p of polis ?? []) for (const s of p.specializations) m.set(s.id, s.name);
    return m;
  }, [polis]);
}

// ── sections ──

function PoliSection({ polis }: { polis: CalqPoli[] | null }) {
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      (polis ?? [])
        .flatMap((p) => p.specializations.map((s) => ({ poli: p, spec: s })))
        .filter((r) => `${r.poli.name} ${r.spec.name}`.toLowerCase().includes(q.toLowerCase())),
    [polis, q],
  );
  const paged = usePaged(rows, q);
  if (!polis) return <Loading />;
  return (
    <div className="space-y-3">
      <SearchBox value={q} onChange={setQ} placeholder="Cari poli / spesialisasi…" />
      <DataTable head={["Spesialisasi", "Poli", "Tipe Reservasi", "ID"]} empty={rows.length === 0}>
        {paged.rows.map((r) => (
          <tr key={r.spec.id}>
            <Td className="font-medium">{r.spec.name}</Td>
            <Td className="text-muted-foreground">{r.poli.name}</Td>
            <Td><TypeChip exact={r.spec.bookingOrderType === "EXACT_TIME"} /></Td>
            <Td className="tabular-nums text-muted-foreground">{r.spec.id}</Td>
          </tr>
        ))}
      </DataTable>
      <Pager {...paged} />
    </div>
  );
}

function DoctorsSection({ polis }: { polis: CalqPoli[] | null }) {
  const [specId, setSpecId] = useState<number | "">("");
  const [doctors, setDoctors] = useState<CalqDoctor[] | null>(null);

  useEffect(() => {
    if (!specId) return;
    setDoctors(null);
    apiGet<{ doctors: CalqDoctor[] }>(`/api/admin/calq/doctors?specializationId=${specId}`)
      .then((r) => setDoctors(r.doctors))
      .catch(() => setDoctors([]));
  }, [specId]);

  if (!polis) return <Loading />;
  return (
    <div className="space-y-3">
      <select
        value={specId}
        onChange={(e) => setSpecId(Number(e.target.value) || "")}
        className="h-10 max-w-sm rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">— Pilih spesialisasi —</option>
        {polis.flatMap((p) =>
          p.specializations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {p.name !== s.name ? ` (${p.name})` : ""}
            </option>
          ))
        )}
      </select>

      {specId !== "" && !doctors && <Loading />}
      {specId !== "" && doctors && (
        <DataTable head={["Dokter", "Tipe", "Jadwal Praktik"]} empty={doctors.length === 0}>
          {doctors.map((d) => (
            <tr key={d.id} className="align-top">
              <Td className="font-medium">{d.name}</Td>
              <Td>
                <TypeChip exact={d.bookingOrderType === "EXACT_TIME"} />
                {d.bookingOrderType === "EXACT_TIME" && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {d.sessionDuration} mnt/slot
                  </span>
                )}
              </Td>
              <Td>
                <div className="space-y-0.5">
                  {d.schedules
                    .slice()
                    .sort((a, b) =>
                      a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)
                    )
                    .map((s, i) => (
                      <p key={i} className="text-xs">
                        <span className="inline-block w-14 font-medium">{DAYS[s.dayOfWeek]}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {s.startTime} – {s.endTime}
                        </span>
                      </p>
                    ))}
                  {d.schedules.length === 0 && (
                    <span className="text-xs text-muted-foreground">Tidak ada jadwal.</span>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      {specId === "" && (
        <p className="text-sm text-muted-foreground">
          Pilih spesialisasi untuk melihat dokter dan jadwal praktiknya.
        </p>
      )}
    </div>
  );
}

function ProceduresSection({ polis }: { polis: CalqPoli[] | null }) {
  const [procs, setProcs] = useState<CalqProcedure[] | null>(null);
  const [q, setQ] = useState("");
  const specNames = useSpecNames(polis);

  useEffect(() => {
    apiGet<{ procedures: CalqProcedure[] }>("/api/admin/calq/procedures")
      .then((r) => setProcs(r.procedures))
      .catch(() => setProcs([]));
  }, []);

  const rows = useMemo(
    () => (procs ?? []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase())),
    [procs, q],
  );
  const paged = usePaged(rows, q);
  if (!procs) return <Loading />;
  return (
    <div className="space-y-3">
      <SearchBox value={q} onChange={setQ} placeholder="Cari tindakan…" />
      <DataTable head={["Tindakan", "Spesialisasi", "Harga", "DP Calq", "ID"]} empty={rows.length === 0}>
        {paged.rows.map((p) => (
          <tr key={p.id}>
            <Td className="font-medium">{p.name}</Td>
            <Td className="text-muted-foreground">{specNames.get(p.specializationId) ?? "—"}</Td>
            <Td className="tabular-nums">{formatRupiah(p.price)}</Td>
            <Td className="tabular-nums text-muted-foreground">
              {p.isDownPayment ? formatRupiah(p.downPaymentAmount) : "—"}
            </Td>
            <Td className="tabular-nums text-muted-foreground">{p.id}</Td>
          </tr>
        ))}
      </DataTable>
      <Pager {...paged} />
    </div>
  );
}

function ProductsSection() {
  const [products, setProducts] = useState<CalqProduct[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    apiGet<{ products: CalqProduct[] }>("/api/admin/calq/products")
      .then((r) => setProducts(r.products))
      .catch(() => setProducts([]));
  }, []);

  const rows = useMemo(
    () =>
      (products ?? []).filter((p) =>
        `${p.name} ${p.genericName ?? ""} ${p.manufacturer ?? ""} ${p.sku ?? ""}`
          .toLowerCase()
          .includes(q.toLowerCase())
      ),
    [products, q],
  );
  const paged = usePaged(rows, q);
  if (!products) return <Loading />;
  return (
    <div className="space-y-3">
      <SearchBox value={q} onChange={setQ} placeholder="Cari obat / produk…" />
      <DataTable
        head={["Nama", "Generik", "Bentuk / Dosis", "Pabrikan", "Harga", "ID"]}
        empty={rows.length === 0}
      >
        {paged.rows.map((p) => (
          <tr key={p.id}>
            <Td className="font-medium">
              {p.name}
              {p.sku && <span className="ml-1.5 text-xs text-muted-foreground">({p.sku})</span>}
            </Td>
            <Td className="text-muted-foreground">{p.genericName ?? "—"}</Td>
            <Td className="text-muted-foreground">
              {[p.form, p.dosage].filter(Boolean).join(" · ") || "—"}
            </Td>
            <Td className="text-muted-foreground">{p.manufacturer ?? "—"}</Td>
            <Td className="tabular-nums">{p.price > 0 ? formatRupiah(p.price) : "—"}</Td>
            <Td className="tabular-nums text-muted-foreground">{p.id}</Td>
          </tr>
        ))}
      </DataTable>
      <Pager {...paged} />
      <p className="text-[11px] text-muted-foreground">
        Obat/produk belum bisa dijual lewat form reservasi — daftar ini untuk referensi.
      </p>
    </div>
  );
}

function VaccinesSection() {
  const [vaccines, setVaccines] = useState<CalqVaccine[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    apiGet<{ vaccines: CalqVaccine[] }>("/api/admin/calq/vaccines")
      .then((r) => setVaccines(r.vaccines))
      .catch(() => setVaccines([]));
  }, []);

  const rows = useMemo(
    () => (vaccines ?? []).filter((v) => v.name.toLowerCase().includes(q.toLowerCase())),
    [vaccines, q],
  );
  const paged = usePaged(rows, q);
  if (!vaccines) return <Loading />;
  return (
    <div className="space-y-3">
      <SearchBox value={q} onChange={setQ} placeholder="Cari vaksin…" />
      <DataTable
        head={["Vaksin", "Tipe", "Rentang Usia", "Frekuensi", "Tindakan Terkait"]}
        empty={rows.length === 0}
      >
        {paged.rows.map((v) => (
          <tr key={v.id}>
            <Td className="font-medium">{v.name}</Td>
            <Td className="text-muted-foreground">{v.type ?? "—"}</Td>
            <Td className="text-muted-foreground">{v.ageRange ?? "—"}</Td>
            <Td className="tabular-nums text-muted-foreground">
              {v.frequency != null ? `${v.frequency}×` : "—"}
            </Td>
            <Td className="tabular-nums text-muted-foreground">
              {v.procedureId != null ? `#${v.procedureId}` : "—"}
            </Td>
          </tr>
        ))}
      </DataTable>
      <Pager {...paged} />
    </div>
  );
}

function RoomsSection() {
  const [rooms, setRooms] = useState<CalqRoom[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    apiGet<{ rooms: CalqRoom[] }>("/api/admin/calq/rooms")
      .then((r) => setRooms(r.rooms))
      .catch(() => setRooms([]));
  }, []);

  const rows = useMemo(
    () => (rooms ?? []).filter((r) => r.name.toLowerCase().includes(q.toLowerCase())),
    [rooms, q],
  );
  const paged = usePaged(rows, q);
  if (!rooms) return <Loading />;
  return (
    <div className="space-y-3">
      <SearchBox value={q} onChange={setQ} placeholder="Cari ruangan…" />
      <DataTable head={["Ruangan", "Status", "ID"]} empty={rows.length === 0}>
        {paged.rows.map((r) => (
          <tr key={r.id}>
            <Td className="font-medium">{r.name}</Td>
            <Td>
              <span className={cn("chip", r.isActive ? "chip-success" : "chip-warning")}>
                {r.isActive ? "Aktif" : "Nonaktif"}
              </span>
            </Td>
            <Td className="tabular-nums text-muted-foreground">{r.id}</Td>
          </tr>
        ))}
      </DataTable>
      <Pager {...paged} />
      <p className="text-[11px] text-muted-foreground">
        ID ruangan dipakai untuk pengaturan CALQ_DEFAULT_ROOM_ID (ruang default sale reservasi).
      </p>
    </div>
  );
}

function PaymentsSection() {
  const [methods, setMethods] = useState<CalqPaymentMethod[] | null>(null);
  const [configuredId, setConfiguredId] = useState<number | null>(null);

  useEffect(() => {
    apiGet<{ configuredId: number; methods: CalqPaymentMethod[] }>(
      "/api/admin/calq/payment-methods",
    )
      .then((r) => {
        setMethods(r.methods);
        setConfiguredId(r.configuredId);
      })
      .catch(() => setMethods([]));
  }, []);

  const paged = usePaged(methods ?? [], "");
  if (!methods) return <Loading />;
  return (
    <div className="space-y-3">
      <DataTable head={["Metode", "Kategori", "Status", "ID"]} empty={methods.length === 0}>
        {paged.rows.map((m) => (
          <tr key={m.id}>
            <Td className="font-medium">
              {m.name}
              {m.id === configuredId && (
                <span className="ml-2 chip chip-info">dipakai reservasi</span>
              )}
            </Td>
            <Td className="text-muted-foreground">{m.category ?? "—"}</Td>
            <Td>
              <span className={cn("chip", m.isActive ? "chip-success" : "chip-warning")}>
                {m.isActive ? "Aktif" : "Nonaktif"}
              </span>
            </Td>
            <Td className="tabular-nums text-muted-foreground">{m.id}</Td>
          </tr>
        ))}
      </DataTable>
      <Pager {...paged} />
      <p className="text-[11px] text-muted-foreground">
        Metode bertanda "dipakai reservasi" adalah tempat pembayaran DOKU dicatat di Calq
        (CALQ_PAYMENT_METHOD_ID).
      </p>
    </div>
  );
}
