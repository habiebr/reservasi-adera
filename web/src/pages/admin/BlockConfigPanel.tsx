// Per-kind config forms for the selected block. Calq-backed pickers (poli / tindakan)
// degrade to plain id text when Calq is unreachable, so the builder never locks up.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  BLOCK_LABELS,
  type CustomField,
  type FormBlock,
  type ScreeningQuestion,
} from "@shared/formTypes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiGet } from "@/lib/api";
import { formatRupiah } from "@shared/pricing";
import { cn } from "@/lib/utils";

interface CalqSpec {
  id: number;
  name: string;
  bookingOrderType: string;
}
interface CalqProc {
  id: number;
  name: string;
  price: number;
  specializationId: number;
}
interface AdminBundle {
  id: string;
  name: string;
  active: boolean;
  price?: number;
  items: { procedureName: string; quantity: number }[];
}

export default function BlockConfigPanel({
  block,
  dateFirst,
  onChange,
}: {
  block: FormBlock;
  /** The form asks for the date before the doctor — changes what these settings drive. */
  dateFirst: boolean;
  onChange: (patch: Partial<FormBlock>) => void;
}) {
  const c = block.config;
  const setConfig = (patch: Partial<typeof c>) => onChange({ config: patch });

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pengaturan blok
        </p>
        <h3 className="font-display text-base font-bold text-foreground">
          {BLOCK_LABELS[block.kind]}
        </h3>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Judul tampilan (opsional)</Label>
        <Input
          value={block.title ?? ""}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={BLOCK_LABELS[block.kind]}
          className="h-9 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Deskripsi (opsional)</Label>
        <Textarea
          rows={2}
          value={block.description ?? ""}
          onChange={(e) => onChange({ description: e.target.value })}
          className="text-sm"
        />
      </div>

      {block.kind === "poli_picker" && (
        <>
          <label className="flex items-start gap-2.5 rounded-lg border border-border p-3">
            <Checkbox
              checked={c.singlePoli === true}
              onCheckedChange={(v) =>
                setConfig({
                  singlePoli: v === true,
                  // switching on with a broad allow-list would be ambiguous: keep the first
                  allowedSpecializations: v === true
                    ? (c.allowedSpecializations ?? []).slice(0, 1)
                    : c.allowedSpecializations,
                })}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                Form ini khusus satu poli
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                Langkah "Pilih Poli" tidak ditampilkan ke pasien — polinya sudah ditentukan di
                sini. Dipakai kalau form ditempel di halaman poli itu sendiri.
              </span>
            </span>
          </label>
          <PoliAllowList block={block} setConfig={setConfig} single={c.singlePoli === true} />
        </>
      )}

      {block.kind === "schedule_picker" && (
        <>
          {dateFirst && (
            <p className="rounded-lg bg-info/10 p-3 text-xs leading-relaxed text-foreground">
              Blok ini berada <strong>sebelum</strong> Pilih Dokter, jadi pasien memilih tanggal
              dulu: kalender menampilkan semua hari praktik di poli ini, lalu daftar dokter
              menyesuaikan hari yang dipilih. Pilihan jam ikut pindah ke blok Pilih Dokter.
            </p>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Maksimal hari ke depan</Label>
            <Input
              type="number"
              min={1}
              max={180}
              value={c.maxDaysAhead ?? 30}
              onChange={(e) => setConfig({ maxDaysAhead: Number(e.target.value) || 30 })}
              className="h-9 w-28 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Tampilan pilihan jam{dateFirst ? " (tampil di blok Pilih Dokter)" : ""}
            </Label>
            <div className="flex gap-2">
              {(["segmented", "dropdown"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setConfig({ timeDisplay: v })}
                  className={cn(
                    "rounded-lg border-2 px-3 py-1.5 text-sm transition-all",
                    (c.timeDisplay ?? "segmented") === v
                      ? "border-primary bg-primary-muted text-primary"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {v === "segmented" ? "Kotak jam" : "Dropdown"}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {block.kind === "doctor_picker" && dateFirst && (
        <p className="rounded-lg bg-info/10 p-3 text-xs leading-relaxed text-foreground">
          Blok ini berada <strong>setelah</strong> Pilih Jadwal: daftarnya hanya memuat dokter
          yang praktik pada tanggal yang dipilih pasien, dan pilihan jam muncul di bawah dokter
          yang dipilih.
        </p>
      )}

      {block.kind === "patient_lookup" && (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={c.allowMrn ?? true}
            onCheckedChange={(v) => setConfig({ allowMrn: v === true })}
          />
          Izinkan pencarian dengan No. RM
        </label>
      )}

      {block.kind === "patient_data" && (
        <>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={c.askAddress ?? true}
              onCheckedChange={(v) => setConfig({ askAddress: v === true })}
            />
            Tanyakan alamat domisili
          </label>
          <CustomFieldsEditor
            fields={c.customFields ?? []}
            onChange={(fields) => setConfig({ customFields: fields })}
          />
        </>
      )}

      {block.kind === "pricing_payment" && <PricingConfig block={block} setConfig={setConfig} />}

      {block.kind === "summary_consent" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Teks persetujuan</Label>
          <Textarea
            rows={4}
            value={c.consentText ?? ""}
            onChange={(e) => setConfig({ consentText: e.target.value })}
            className="text-sm"
          />
        </div>
      )}

      {block.kind === "info_page" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Isi teks (baris baru = paragraf)</Label>
            <Textarea
              rows={6}
              value={c.infoBody ?? ""}
              onChange={(e) => setConfig({ infoBody: e.target.value })}
              className="text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={c.requireAck ?? false}
              onCheckedChange={(v) => setConfig({ requireAck: v === true })}
            />
            Wajib centang "sudah membaca" sebelum lanjut
          </label>
        </>
      )}

      {block.kind === "screening" && (
        <ScreeningEditor
          questions={c.screeningQuestions ?? []}
          onChange={(screeningQuestions) => setConfig({ screeningQuestions })}
        />
      )}
    </div>
  );
}

function PoliAllowList({
  block,
  setConfig,
  single,
}: {
  block: FormBlock;
  setConfig: (p: Partial<FormBlock["config"]>) => void;
  /** One poli only: picking replaces the choice instead of adding to a list. */
  single: boolean;
}) {
  const [specs, setSpecs] = useState<CalqSpec[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    apiGet<{ polis: { specializations: CalqSpec[] }[] }>("/api/admin/calq/polis")
      .then((r) => setSpecs(r.polis.flatMap((p) => p.specializations)))
      .catch(() => setFailed(true));
  }, []);

  const allowed = block.config.allowedSpecializations ?? [];
  const toggle = (s: CalqSpec) => {
    const has = allowed.some((a) => a.id === s.id);
    if (single) {
      setConfig({ allowedSpecializations: has ? [] : [{ id: s.id, name: s.name }] });
      return;
    }
    setConfig({
      allowedSpecializations: has
        ? allowed.filter((a) => a.id !== s.id)
        : [...allowed, { id: s.id, name: s.name }],
    });
  };

  if (failed) {
    return (
      <p className="rounded-lg bg-warning-muted p-2 text-xs text-warning-foreground">
        Calq tidak terjangkau — daftar poli tidak bisa dimuat sekarang. Konfigurasi tersimpan tetap
        berlaku.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {single ? "Poli untuk form ini" : "Poli yang ditawarkan"}{" "}
        <span className="font-normal text-muted-foreground">
          {single ? "(pilih satu)" : "(kosong = semua)"}
        </span>
      </Label>
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
        {(specs ?? []).map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={allowed.some((a) => a.id === s.id)}
              onCheckedChange={() => toggle(s)}
            />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="text-[10px] text-muted-foreground">
              {s.bookingOrderType === "EXACT_TIME" ? "jam" : "antrean"}
            </span>
          </label>
        ))}
        {!specs && <p className="p-2 text-xs text-muted-foreground">Memuat dari Calq…</p>}
      </div>
      {single
        ? (
          <p className="text-[11px] text-muted-foreground">
            {allowed.length === 1
              ? `Pasien langsung masuk ke langkah berikutnya dengan poli ${allowed[0].name}.`
              : "Belum ada poli yang dipilih — form belum bisa diterbitkan."}
          </p>
        )
        : allowed.length > 0 && (
          <p className="text-[11px] text-muted-foreground">{allowed.length} poli dipilih.</p>
        )}
    </div>
  );
}

function PricingConfig({
  block,
  setConfig,
}: {
  block: FormBlock;
  setConfig: (p: Partial<FormBlock["config"]>) => void;
}) {
  const c = block.config;
  const [procs, setProcs] = useState<CalqProc[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    apiGet<{ procedures: CalqProc[] }>("/api/admin/calq/procedures")
      .then((r) => setProcs(r.procedures))
      .catch(() => setFailed(true));
  }, []);

  const allowed = c.allowedProcedures ?? [];
  const toggle = (p: CalqProc) => {
    const has = allowed.some((a) => a.id === p.id);
    setConfig({
      allowedProcedures: has
        ? allowed.filter((a) => a.id !== p.id)
        : [...allowed, { id: p.id, name: p.name }],
    });
  };

  const visible = (procs ?? [])
    .filter((p) => p.price > 0)
    .filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, 60);

  const mode = c.pricingMode ?? "procedure";

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Sumber daftar tindakan</Label>
        <div className="flex gap-2">
          {(
            [
              ["procedure", "Tindakan Calq"],
              ["package", "Paket kustom"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setConfig({ pricingMode: v })}
              className={cn(
                "rounded-lg border-2 px-3 py-1.5 text-sm transition-all",
                mode === v
                  ? "border-primary bg-primary-muted text-primary"
                  : "border-border text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {mode === "package"
            ? "Pasien memilih dari paket yang dikelola di tab Paket."
            : "Pasien memilih langsung dari tindakan aktif di Calq."}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Uang muka (DP)</Label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={c.dpEnabled ?? false}
            onCheckedChange={(v) => setConfig({ dpEnabled: v === true })}
          />
          Tawarkan opsi DP
        </label>
        {c.dpEnabled && (
          <div className="space-y-2 rounded-lg border border-border p-2">
            {(
              [
                ["calq", "Ikuti pengaturan tindakan di Calq"],
                ["fixed", "Nominal tetap"],
                ["percent", "Persentase dari total"],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name={`dp-rule-${block.id}`}
                  checked={(c.dpRule ?? "calq") === v}
                  onChange={() => setConfig({ dpRule: v })}
                  className="accent-primary"
                />
                {label}
              </label>
            ))}
            {(c.dpRule === "fixed" || c.dpRule === "calq") && (
              <div className="space-y-1">
                <Label className="text-xs">
                  {c.dpRule === "calq" ? "Nominal cadangan (Rp)" : "Nominal DP (Rp)"}
                </Label>
                <Input
                  type="number"
                  min={0}
                  step={10000}
                  value={c.dpValue ?? 100000}
                  onChange={(e) => setConfig({ dpValue: Number(e.target.value) || 0 })}
                  className="h-9 w-36 text-sm"
                />
              </div>
            )}
            {c.dpRule === "percent" && (
              <div className="space-y-1">
                <Label className="text-xs">Persen (%)</Label>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={c.dpValue ?? 30}
                  onChange={(e) => setConfig({ dpValue: Number(e.target.value) || 0 })}
                  className="h-9 w-24 text-sm"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {mode === "package" && <BundleAllowList block={block} setConfig={setConfig} />}

      {mode === "procedure" && (
      <div className="space-y-1.5">
        <Label className="text-xs">
          Tindakan yang ditawarkan{" "}
          <span className="font-normal text-muted-foreground">(kosong = semua yang aktif)</span>
        </Label>
        {failed
          ? (
            <p className="rounded-lg bg-warning-muted p-2 text-xs text-warning-foreground">
              Calq tidak terjangkau — daftar tindakan tidak bisa dimuat sekarang.
            </p>
          )
          : (
            <>
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Cari tindakan…"
                className="h-9 text-sm"
              />
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {visible.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox
                      checked={allowed.some((a) => a.id === p.id)}
                      onCheckedChange={() => toggle(p)}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {formatRupiah(p.price)}
                    </span>
                  </label>
                ))}
                {!procs && <p className="p-2 text-xs text-muted-foreground">Memuat dari Calq…</p>}
                {procs && visible.length === 0 && (
                  <p className="p-2 text-xs text-muted-foreground">Tidak ada yang cocok.</p>
                )}
              </div>
              {allowed.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {allowed.length} tindakan dipilih.
                </p>
              )}
            </>
          )}
      </div>
      )}
    </div>
  );
}

function BundleAllowList({
  block,
  setConfig,
}: {
  block: FormBlock;
  setConfig: (p: Partial<FormBlock["config"]>) => void;
}) {
  const [bundles, setBundles] = useState<AdminBundle[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    apiGet<{ bundles: AdminBundle[] }>("/api/admin/bundles")
      .then((r) => setBundles(r.bundles.filter((b) => b.active)))
      .catch(() => setFailed(true));
  }, []);

  const allowed = block.config.allowedBundles ?? [];
  const toggle = (b: AdminBundle) => {
    const has = allowed.some((a) => a.id === b.id);
    setConfig({
      allowedBundles: has
        ? allowed.filter((a) => a.id !== b.id)
        : [...allowed, { id: b.id, name: b.name }],
    });
  };

  if (failed) {
    return (
      <p className="rounded-lg bg-warning-muted p-2 text-xs text-warning-foreground">
        Daftar paket tidak bisa dimuat sekarang. Konfigurasi tersimpan tetap berlaku.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        Paket yang ditawarkan{" "}
        <span className="font-normal text-muted-foreground">(kosong = semua paket aktif)</span>
      </Label>
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
        {(bundles ?? []).map((b) => (
          <label key={b.id} className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={allowed.some((a) => a.id === b.id)}
              onCheckedChange={() => toggle(b)}
            />
            <span className="min-w-0 flex-1 truncate">{b.name}</span>
            {b.price !== undefined && (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {formatRupiah(b.price)}
              </span>
            )}
          </label>
        ))}
        {!bundles && <p className="p-2 text-xs text-muted-foreground">Memuat paket…</p>}
        {bundles && bundles.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">
            Belum ada paket — buat dulu di tab Paket.
          </p>
        )}
      </div>
      {allowed.length > 0 && (
        <p className="text-[11px] text-muted-foreground">{allowed.length} paket dipilih.</p>
      )}
    </div>
  );
}

function ScreeningEditor({
  questions,
  onChange,
}: {
  questions: ScreeningQuestion[];
  onChange: (q: ScreeningQuestion[]) => void;
}) {
  const patch = (id: string, p: Partial<ScreeningQuestion>) =>
    onChange(questions.map((q) => (q.id === id ? { ...q, ...p } : q)));
  return (
    <div className="space-y-2">
      <Label className="text-xs">Pertanyaan skrining (jawaban Ya / Tidak)</Label>
      {questions.map((q) => (
        <div key={q.id} className="space-y-2 rounded-lg border border-border p-2">
          <div className="flex items-start gap-2">
            <Textarea
              rows={2}
              value={q.text}
              onChange={(e) => patch(q.id, { text: e.target.value })}
              placeholder="Contoh: Apakah Anda sedang demam?"
              className="flex-1 text-sm"
            />
            <button
              onClick={() => onChange(questions.filter((x) => x.id !== q.id))}
              className="mt-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Label className="shrink-0 text-xs text-muted-foreground">Jawaban penghalang</Label>
            <select
              value={q.blockAnswer ?? ""}
              onChange={(e) =>
                patch(q.id, { blockAnswer: e.target.value as ScreeningQuestion["blockAnswer"] })}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">Tidak ada</option>
              <option value="Ya">Ya</option>
              <option value="Tidak">Tidak</option>
            </select>
          </div>
          {q.blockAnswer && (
            <Input
              value={q.blockMessage ?? ""}
              onChange={(e) => patch(q.id, { blockMessage: e.target.value })}
              placeholder="Pesan saat terhalang (opsional)"
              className="h-9 text-sm"
            />
          )}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...questions,
            { id: crypto.randomUUID(), text: "", blockAnswer: "", blockMessage: "" },
          ])}
        className="w-full gap-1 border-dashed"
      >
        <Plus className="h-3.5 w-3.5" /> Tambah pertanyaan
      </Button>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Jika pasien memilih jawaban penghalang, reservasi berhenti dengan pesan tersebut. Semua
        jawaban tersimpan di detail reservasi.
      </p>
    </div>
  );
}

function CustomFieldsEditor({
  fields,
  onChange,
}: {
  fields: CustomField[];
  onChange: (f: CustomField[]) => void;
}) {
  const patch = (id: string, p: Partial<CustomField>) =>
    onChange(fields.map((f) => (f.id === id ? { ...f, ...p } : f)));
  return (
    <div className="space-y-2">
      <Label className="text-xs">Isian tambahan</Label>
      {fields.map((f) => (
        <div key={f.id} className="space-y-2 rounded-lg border border-border p-2">
          <div className="flex items-center gap-2">
            <Input
              value={f.label}
              onChange={(e) => patch(f.id, { label: e.target.value })}
              placeholder="Label isian"
              className="h-9 flex-1 text-sm"
            />
            <button
              onClick={() => onChange(fields.filter((x) => x.id !== f.id))}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={f.fieldType}
              onChange={(e) =>
                patch(f.id, { fieldType: e.target.value as CustomField["fieldType"] })}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="text">Teks singkat</option>
              <option value="textarea">Teks panjang</option>
              <option value="choice">Pilihan</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <Checkbox
                checked={f.required}
                onCheckedChange={(v) => patch(f.id, { required: v === true })}
                className="h-3.5 w-3.5"
              />
              Wajib
            </label>
          </div>
          {f.fieldType === "choice" && (
            <Input
              value={f.options.join(", ")}
              onChange={(e) =>
                patch(f.id, { options: e.target.value.split(",").map((s) => s.trim()) })}
              placeholder="Opsi dipisah koma: Ya, Tidak"
              className="h-9 text-sm"
            />
          )}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...fields,
            {
              id: crypto.randomUUID(),
              label: "",
              fieldType: "text",
              options: [],
              required: false,
            },
          ])}
        className="w-full gap-1 border-dashed"
      >
        <Plus className="h-3.5 w-3.5" /> Tambah isian
      </Button>
    </div>
  );
}
