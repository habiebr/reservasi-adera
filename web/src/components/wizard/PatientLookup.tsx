import { useState } from "react";
import { CheckCircle2, Search, UserPlus } from "lucide-react";
import { isValidTanggalLahir } from "@shared/identity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost, type LookupResponse } from "@/lib/api";
import DateSegments from "./DateSegments";
import { emptyPatient } from "./types";
import type { BlockProps } from "./types";
import { cn } from "@/lib/utils";

export default function PatientLookup({ slug, block, data, update }: BlockProps) {
  const allowMrn = block.config.allowMrn ?? true;
  const [mode, setMode] = useState<"nik" | "mrn">("nik");
  const [value, setValue] = useState("");
  const [dob, setDob] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    const v = value.trim();
    if (mode === "nik" && !/^\d{16}$/.test(v)) {
      setError("NIK harus 16 digit angka.");
      return;
    }
    if (mode === "mrn" && v.length < 4) {
      setError("No. RM terlalu pendek.");
      return;
    }
    if (!isValidTanggalLahir(dob)) {
      setError("Isi tanggal lahir dengan lengkap.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await apiPost<LookupResponse>("/api/booking/lookup", {
        slug,
        [mode]: v,
        tanggal_lahir: dob,
      });
      if (r.found) {
        update({
          lookupDone: true,
          found: true,
          calqPatientId: r.calq_patient_id,
          maskedName: r.masked_name,
          patient: {
            ...data.patient,
            nik: mode === "nik" ? v : data.patient.nik,
            mrn: r.mrn ?? "",
            tanggal_lahir: dob,
          },
        });
      } else {
        update({
          lookupDone: true,
          found: false,
          calqPatientId: undefined,
          maskedName: undefined,
          patient: { ...emptyPatient, nik: mode === "nik" ? v : "", tanggal_lahir: dob },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memeriksa data.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {block.description && <p className="text-sm text-muted-foreground">{block.description}</p>}
      {allowMrn && (
        <div className="inline-flex rounded-lg border border-border bg-secondary p-1">
          {(["nik", "mrn"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setValue("");
              }}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                mode === m ? "bg-card text-primary shadow-sm" : "text-muted-foreground",
              )}
            >
              {m === "nik" ? "NIK" : "No. RM"}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        <Label>{mode === "nik" ? "NIK" : "No. RM"}</Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            inputMode={mode === "nik" ? "numeric" : "text"}
            maxLength={mode === "nik" ? 16 : 20}
            placeholder={mode === "nik" ? "Contoh: 3374xxxxxxxxxxxx" : "Contoh: SBA001234"}
            value={value}
            onChange={(e) =>
              setValue(mode === "nik" ? e.target.value.replace(/\D/g, "") : e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
            }}
            className="h-11 pl-9"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Tanggal lahir</Label>
          <DateSegments value={dob} onChange={setDob} />
        </div>
        <Button onClick={run} disabled={loading} className="h-11 px-6">
          {loading ? "Memeriksa…" : "Cek"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {data.lookupDone && data.found && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-success/40 bg-success/5 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Data ditemukan: {data.maskedName}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.patient.mrn ? `No. RM ${data.patient.mrn}. ` : ""}
              Data lengkap Anda sudah tersimpan di klinik — lanjut ke langkah berikutnya.
            </p>
            <button
              type="button"
              onClick={() => update({ lookupDone: false, found: false, calqPatientId: undefined })}
              className="mt-1 text-xs font-medium text-primary hover:underline"
            >
              Bukan Anda? Cari ulang
            </button>
          </div>
        </div>
      )}
      {data.lookupDone && !data.found && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-info/40 bg-info/5 p-4">
          <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-info" />
          <div>
            <p className="text-sm font-semibold text-foreground">Data tidak ditemukan</p>
            <p className="text-xs text-muted-foreground">
              Pastikan {mode === "nik" ? "NIK" : "No. RM"} dan tanggal lahir sudah benar, atau
              lengkapi data diri di bawah untuk mendaftar sebagai pasien baru.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
