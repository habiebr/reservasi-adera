import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { BlockProps } from "./types";

/** DD / MM / YYYY segmented date input (the vaksinadera StepDataDiri idiom). */
function DateSegments({
  value,
  onChange,
}: {
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
}) {
  const [y = "", m = "", d = ""] = value ? value.split("-") : [];
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const set = (dd: string, mm: string, yy: string) => {
    if (dd || mm || yy) onChange(`${yy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`);
    else onChange("");
  };
  const seg = (
    idx: number,
    val: string,
    max: number,
    placeholder: string,
    apply: (v: string) => void,
  ) => (
    <Input
      ref={refs[idx]}
      inputMode="numeric"
      value={val.replace(/^0+(?=\d{2,})/, "")}
      placeholder={placeholder}
      maxLength={max}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, "").slice(0, max);
        apply(v);
        if (v.length === max && idx < 2) refs[idx + 1].current?.focus();
      }}
      className="h-11 w-16 text-center font-mono tabular-nums sm:w-20"
    />
  );
  return (
    <div className="flex items-center gap-2">
      {seg(0, d, 2, "DD", (v) => set(v, m, y))}
      <span className="text-muted-foreground">/</span>
      {seg(1, m, 2, "MM", (v) => set(d, v, y))}
      <span className="text-muted-foreground">/</span>
      {seg(2, y, 4, "YYYY", (v) => set(d, m, v))}
    </div>
  );
}

export default function PatientDataForm({ slug, block, data, update }: BlockProps) {
  const askAddress = block.config.askAddress ?? true;
  const customFields = block.config.customFields ?? [];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const p = data.patient;

  if (data.found) return null; // existing patient — nothing to fill

  const setP = (patch: Partial<typeof p>) => update({ patient: { ...p, ...patch } });

  const canSubmit = /^\d{16}$/.test(p.nik) && p.nama_lengkap.trim().length >= 2 &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.tanggal_lahir) && p.jenis_kelamin &&
    p.nomor_hp.replace(/\D/g, "").length >= 9;

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await apiPost<{ calq_patient_id: string; mrn: string | null }>(
        "/api/booking/patient",
        { slug, patient: { ...p, nomor_hp: p.nomor_hp.replace(/\D/g, "") } },
      );
      update({ calqPatientId: r.calq_patient_id, patient: { ...p, mrn: r.mrn ?? "" } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan data pasien.");
    } finally {
      setSaving(false);
    }
  };

  const registered = Boolean(data.calqPatientId);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="nama">Nama lengkap (sesuai KTP)</Label>
          <Input
            id="nama"
            value={p.nama_lengkap}
            disabled={registered}
            onChange={(e) => setP({ nama_lengkap: e.target.value.toUpperCase() })}
            placeholder="NAMA LENGKAP"
            className="h-11 uppercase"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nik">NIK</Label>
          <Input
            id="nik"
            inputMode="numeric"
            maxLength={16}
            value={p.nik}
            disabled={registered}
            onChange={(e) => setP({ nik: e.target.value.replace(/\D/g, "") })}
            placeholder="16 digit"
            className="h-11 font-mono tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Tanggal lahir</Label>
          <DateSegments value={p.tanggal_lahir} onChange={(v) => !registered && setP({ tanggal_lahir: v })} />
        </div>
        <div className="space-y-1.5">
          <Label>Jenis kelamin</Label>
          <div className="flex gap-2">
            {["Laki-laki", "Perempuan"].map((g) => (
              <button
                key={g}
                type="button"
                disabled={registered}
                onClick={() => setP({ jenis_kelamin: g })}
                className={cn(
                  "h-11 flex-1 rounded-lg border-2 text-sm font-medium transition-all",
                  p.jenis_kelamin === g
                    ? "border-primary bg-primary-muted text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/60",
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hp">Nomor HP / WhatsApp</Label>
          <Input
            id="hp"
            inputMode="tel"
            value={p.nomor_hp}
            disabled={registered}
            onChange={(e) => setP({ nomor_hp: e.target.value })}
            placeholder="08xxxxxxxxxx"
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email (untuk invoice)</Label>
          <Input
            id="email"
            type="email"
            value={p.email}
            disabled={registered}
            onChange={(e) => setP({ email: e.target.value })}
            placeholder="nama@email.com"
            className="h-11"
          />
        </div>
        {askAddress && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alamat">Alamat domisili</Label>
            <Textarea
              id="alamat"
              rows={2}
              value={p.alamat_domisili}
              disabled={registered}
              onChange={(e) => setP({ alamat_domisili: e.target.value })}
              placeholder="Alamat tempat tinggal saat ini"
            />
          </div>
        )}
      </div>

      {customFields.length > 0 && (
        <div className="space-y-4 border-t border-border pt-4">
          {customFields.map((f) => (
            <div key={f.id} className="space-y-1.5">
              <Label>
                {f.label}
                {f.required && <span className="text-destructive"> *</span>}
              </Label>
              {f.fieldType === "textarea" && (
                <Textarea
                  rows={2}
                  value={data.answers[f.id] ?? ""}
                  onChange={(e) => update({ answers: { ...data.answers, [f.id]: e.target.value } })}
                />
              )}
              {f.fieldType === "text" && (
                <Input
                  className="h-11"
                  value={data.answers[f.id] ?? ""}
                  onChange={(e) => update({ answers: { ...data.answers, [f.id]: e.target.value } })}
                />
              )}
              {f.fieldType === "choice" && (
                <div className="flex flex-wrap gap-2">
                  {f.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => update({ answers: { ...data.answers, [f.id]: opt } })}
                      className={cn(
                        "rounded-full border-2 px-4 py-1.5 text-sm transition-all",
                        (data.answers[f.id] ?? "") === opt
                          ? "border-primary bg-primary-muted text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/60",
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {!registered ? (
        <Button onClick={submit} disabled={!canSubmit || saving} className="h-11 w-full sm:w-auto sm:px-8">
          {saving ? "Menyimpan…" : "Simpan & Daftarkan Pasien"}
        </Button>
      ) : (
        <p className="rounded-lg bg-success/10 p-3 text-sm font-medium text-success">
          ✓ Pasien terdaftar{p.mrn ? ` — No. RM ${p.mrn}` : ""}. Silakan lanjut.
        </p>
      )}
    </div>
  );
}
