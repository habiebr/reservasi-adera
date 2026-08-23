import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock,
  ClipboardList,
  Copy,
  ExternalLink,
  FileWarning,
  LayoutList,
  LogOut,
  Package,
  Plus,
  RefreshCcw,
  Settings2,
} from "lucide-react";
import BundlesTab from "./BundlesTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatRupiah } from "@shared/pricing";

interface Me {
  email: string;
  name: string;
}

const TABS = [
  { id: "forms", label: "Form", icon: LayoutList },
  { id: "bundles", label: "Paket", icon: Package },
  { id: "bookings", label: "Reservasi", icon: ClipboardList },
  { id: "calq", label: "Dokter & Jadwal", icon: CalendarClock },
  { id: "failures", label: "Gagal Bayar", icon: FileWarning },
  { id: "settings", label: "Pengaturan", icon: Settings2 },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function AdminApp() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState<TabId>("forms");

  const refresh = useCallback(() => {
    apiGet<Me>("/api/admin/me")
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  useEffect(refresh, [refresh]);

  if (me === undefined) return <div className="min-h-screen bg-background" />;
  if (me === null) return <Login onDone={refresh} />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/logo-adera.webp?v=1" alt="Klinik Adera" className="h-9 w-auto" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
                Klinik Adera
              </p>
              <h1 className="font-display text-lg font-bold leading-tight text-foreground">
                Reservasi — Admin
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:block">{me.email}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => apiPost("/api/admin/logout").then(() => setMe(null))}
              className="gap-1"
            >
              <LogOut className="h-3.5 w-3.5" /> Keluar
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === "forms" && <FormsTab />}
        {tab === "bundles" && <BundlesTab />}
        {tab === "bookings" && <BookingsTab />}
        {tab === "calq" && <CalqTab />}
        {tab === "failures" && <FailuresTab />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/admin/login", { email, password });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal masuk.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-md">
        <img src="/logo-adera.webp?v=1" alt="Klinik Adera" className="mb-4 h-10 w-auto" />
        <h1 className="mb-5 font-display text-xl font-bold text-foreground">Masuk Admin Reservasi</h1>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Kata sandi</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="h-11"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={submit} disabled={busy} className="h-11 w-full">
            {busy ? "Memeriksa…" : "Masuk"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Forms tab ──

interface FormRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  updated_at: string;
  booking_count: string;
}

function FormsTab() {
  const [forms, setForms] = useState<FormRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  const load = () => apiGet<{ forms: FormRow[] }>("/api/admin/forms").then((r) => setForms(r.forms));
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    try {
      const r = await apiPost<{ id: string }>("/api/admin/forms", { title });
      location.href = `/admin/forms/${r.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat form.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-foreground">Form Reservasi</h2>
        <Button onClick={() => setCreating(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Buat Form
        </Button>
      </div>
      {creating && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4">
          <div className="min-w-64 flex-1 space-y-1.5">
            <Label>Judul form</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="cth: Reservasi Poli Gigi"
              className="h-11"
            />
          </div>
          <Button onClick={create} className="h-11">Buat</Button>
          <Button variant="outline" onClick={() => setCreating(false)} className="h-11">
            Batal
          </Button>
          {error && <p className="w-full text-sm text-destructive">{error}</p>}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(forms ?? []).map((f) => (
          <div key={f.id} className="rounded-xl border border-border bg-card p-4 adera-card-hover">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  to={`/admin/forms/${f.id}`}
                  className="block truncate text-sm font-bold text-foreground hover:text-primary"
                >
                  {f.title}
                </Link>
                <p className="text-xs text-muted-foreground">/{f.slug}</p>
              </div>
              <span
                className={cn(
                  "chip shrink-0",
                  f.status === "published" ? "chip-success" : "chip-default",
                )}
              >
                {f.status === "published" ? "Terbit" : "Draf"}
              </span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{f.booking_count} reservasi</p>
            <div className="mt-3 flex gap-2">
              <Button asChild size="sm" variant="outline" className="gap-1">
                <Link to={`/admin/forms/${f.id}`}>Edit</Link>
              </Button>
              {f.status === "published" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => navigator.clipboard.writeText(`${location.origin}/${f.slug}`)}
                  >
                    <Copy className="h-3.5 w-3.5" /> URL
                  </Button>
                  <Button asChild size="sm" variant="outline" className="gap-1">
                    <a href={`/${f.slug}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" /> Buka
                    </a>
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
        {forms?.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada form — buat yang pertama.</p>
        )}
      </div>
    </div>
  );
}

// ── Bookings tab ──

interface BookingRow {
  id: string;
  status: string;
  visit_date: string;
  slot_time: string | null;
  specialization_name: string | null;
  doctor_name: string | null;
  created_at: string;
  form_slug: string | null;
  nama_lengkap: string | null;
  nik: string | null;
  nomor_hp: string | null;
  invoice_number: string | null;
  jenis_pembayaran: string | null;
  amount_due: number | null;
  payment_status: string | null;
  sync_status: string | null;
  emr_error: string | null;
  booking_code: string | null;
  queue_number: string | null;
}

function BookingsTab() {
  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState("");

  const load = () =>
    apiGet<{ bookings: BookingRow[]; total: number }>("/api/admin/bookings").then((r) => {
      setRows(r.bookings);
      setTotal(r.total);
    });
  useEffect(() => {
    load();
  }, []);

  const retry = async (id: string) => {
    setBusyId(id);
    try {
      await apiPost(`/api/admin/bookings/${id}/retry-emr`);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Gagal");
    } finally {
      setBusyId("");
      load();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-foreground">
          Reservasi <span className="text-sm font-normal text-muted-foreground">({total})</span>
        </h2>
        <Button variant="outline" size="sm" onClick={load} className="gap-1">
          <RefreshCcw className="h-3.5 w-3.5" /> Muat ulang
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5">Pasien</th>
              <th className="px-3 py-2.5">Kunjungan</th>
              <th className="px-3 py-2.5">Pembayaran</th>
              <th className="px-3 py-2.5">EMR</th>
              <th className="px-3 py-2.5">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-b border-border/60 align-top">
                <td className="px-3 py-2.5">
                  <p className="font-medium text-foreground">{r.nama_lengkap ?? "-"}</p>
                  <p className="text-xs text-muted-foreground">{r.nik ?? ""} · {r.nomor_hp ?? ""}</p>
                  <p className="text-xs text-muted-foreground">/{r.form_slug}</p>
                </td>
                <td className="px-3 py-2.5">
                  <p className="text-foreground">
                    {String(r.visit_date).slice(0, 10)} {r.slot_time ?? "(antrean)"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.specialization_name} · {r.doctor_name}
                  </p>
                  {r.booking_code && (
                    <p className="font-mono text-xs text-primary">
                      {r.booking_code}
                      {r.queue_number ? ` · antrean ${r.queue_number}` : ""}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      "chip",
                      r.payment_status === "PAID"
                        ? "chip-success"
                        : r.payment_status === "EXPIRED"
                          ? "chip-error"
                          : "chip-warning",
                    )}
                  >
                    {r.payment_status ?? "-"}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.jenis_pembayaran} · {r.amount_due != null ? formatRupiah(Number(r.amount_due)) : "-"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{r.invoice_number}</p>
                </td>
                <td className="px-3 py-2.5">
                  {r.payment_status !== "PAID" ? <span className="text-xs text-muted-foreground">—</span> : (
                    <>
                      <span
                        className={cn(
                          "chip",
                          r.sync_status === "REGISTERED"
                            ? "chip-success"
                            : r.sync_status === "FAILED"
                              ? "chip-error"
                              : "chip-warning",
                        )}
                      >
                        {r.sync_status ?? "PENDING"}
                      </span>
                      {r.emr_error && (
                        <p className="mt-1 max-w-56 text-[11px] leading-tight text-destructive">
                          {r.emr_error}
                        </p>
                      )}
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {r.payment_status === "PAID" && r.sync_status !== "REGISTERED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === r.id}
                      onClick={() => retry(r.id)}
                    >
                      {busyId === r.id ? "…" : "Ulangi EMR"}
                    </Button>
                  )}
                  {r.payment_status === "PAID" && r.sync_status === "REGISTERED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        apiPost(`/api/admin/bookings/${r.id}/resend-email`)
                          .then(() => alert("Email dikirim ulang."))
                          .catch((e) => alert(e.message))}
                    >
                      Kirim Email
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Belum ada reservasi.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Calq read-only tab ──

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

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function CalqTab() {
  const [polis, setPolis] = useState<CalqPoli[] | null>(null);
  const [env, setEnv] = useState("");
  const [specId, setSpecId] = useState<number | null>(null);
  const [doctors, setDoctors] = useState<CalqDoctor[] | null>(null);

  useEffect(() => {
    apiGet<{ env: string; polis: CalqPoli[] }>("/api/admin/calq/polis").then((r) => {
      setPolis(r.polis);
      setEnv(r.env);
    });
  }, []);
  useEffect(() => {
    if (!specId) return;
    setDoctors(null);
    apiGet<{ doctors: CalqDoctor[] }>(`/api/admin/calq/doctors?specializationId=${specId}`).then(
      (r) => setDoctors(r.doctors),
    );
  }, [specId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-foreground">Dokter & Jadwal (Calq)</h2>
        {env && <span className="chip chip-info">env: {env}</span>}
      </div>
      <p className="rounded-lg bg-info/5 p-3 text-sm text-muted-foreground">
        Data dokter dan jadwal praktik dikelola di Calq. Halaman ini hanya menampilkan.
      </p>
      <div className="flex flex-wrap gap-2">
        {(polis ?? []).flatMap((p) =>
          p.specializations.map((s) => (
            <button
              key={s.id}
              onClick={() => setSpecId(s.id)}
              className={cn(
                "rounded-full border-2 px-3 py-1 text-sm transition-all",
                specId === s.id
                  ? "border-primary bg-primary-muted text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/60",
              )}
            >
              {s.name}
            </button>
          ))
        )}
      </div>
      {specId && doctors && (
        <div className="grid gap-3 sm:grid-cols-2">
          {doctors.map((d) => (
            <div key={d.id} className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-bold text-foreground">{d.name}</p>
              <p className="text-xs text-muted-foreground">
                {d.bookingOrderType === "EXACT_TIME"
                  ? `Per janji ${d.sessionDuration} menit`
                  : "Sistem antrean"}
              </p>
              <div className="mt-2 space-y-1">
                {d.schedules
                  .slice()
                  .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
                  .map((s, i) => (
                    <p key={i} className="text-xs text-foreground">
                      <span className="inline-block w-16 font-medium">{DAYS[s.dayOfWeek]}</span>
                      <span className="tabular-nums">{s.startTime} – {s.endTime}</span>
                    </p>
                  ))}
              </div>
            </div>
          ))}
          {doctors.length === 0 && (
            <p className="text-sm text-muted-foreground">Tidak ada dokter di spesialisasi ini.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Failures tab ──

interface FailureRow {
  id: string;
  invoice_number: string | null;
  form_slug: string | null;
  error_message: string | null;
  http_status: number | null;
  resolved: boolean;
  created_at: string;
  payload: { patient?: { nama_lengkap?: string; nomor_hp?: string } } | null;
}

function FailuresTab() {
  const [rows, setRows] = useState<FailureRow[] | null>(null);
  const load = () =>
    apiGet<{ failures: FailureRow[] }>("/api/admin/failures").then((r) => setRows(r.failures));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg font-bold text-foreground">Gagal Bayar (DOKU menolak)</h2>
      <div className="space-y-2">
        {(rows ?? []).map((r) => (
          <div
            key={r.id}
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4",
              r.resolved ? "border-border bg-card opacity-60" : "border-warning/50 bg-warning-muted",
            )}
          >
            <div>
              <p className="text-sm font-semibold text-foreground">
                {r.payload?.patient?.nama_lengkap ?? "(tanpa nama)"} · {r.payload?.patient?.nomor_hp ?? ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {r.invoice_number} · /{r.form_slug} · HTTP {r.http_status ?? "-"} · {r.error_message}
              </p>
            </div>
            {!r.resolved && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => apiPost(`/api/admin/failures/${r.id}/resolve`).then(load)}
              >
                Tandai selesai
              </Button>
            )}
          </div>
        ))}
        {rows?.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada kegagalan. 🎉</p>}
      </div>
    </div>
  );
}

// ── Settings tab ──

function SettingsTab() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [envDefaults, setEnvDefaults] = useState<Record<string, unknown>>({});
  const load = () =>
    apiGet<{ settings: Record<string, string>; env: Record<string, unknown> }>("/api/admin/settings")
      .then((r) => {
        setSettings(r.settings);
        setEnvDefaults(r.env);
      });
  useEffect(() => {
    load();
  }, []);

  const envRow = (key: "calq_env" | "doku_env", label: string, fallback: string) => {
    const current = settings[key] ?? fallback;
    return (
      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">
            Aktif: <b className={current === "production" ? "text-destructive" : "text-success"}>{current}</b>
          </p>
        </div>
        <div className="flex gap-2">
          {["sandbox", "production"].map((v) => (
            <Button
              key={v}
              size="sm"
              variant={current === v ? "default" : "outline"}
              onClick={() => apiPut(`/api/admin/settings/${key}`, { value: v }).then(load)}
            >
              {v}
            </Button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-2xl space-y-3">
      <h2 className="font-display text-lg font-bold text-foreground">Pengaturan</h2>
      {envRow("calq_env", "Lingkungan Calq (EMR)", String(envDefaults.calq_env_default ?? "sandbox"))}
      {envRow("doku_env", "Lingkungan DOKU (pembayaran)", String(envDefaults.doku_env_default ?? "sandbox"))}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold text-foreground">Email invoice</p>
        <p className="text-xs text-muted-foreground">
          SMTP {envDefaults.smtp_enabled ? "aktif" : "nonaktif"} — kredensial diatur lewat berkas
          .env di server (bukan di sini), lalu container di-restart.
        </p>
      </div>
    </div>
  );
}

// referenced for future use
void apiDelete;
