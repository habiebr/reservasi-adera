// Patient-identity helpers, ported from vaksinadera (_shared/patients.ts).

/** Canonical Indonesian phone: digits only, 0-prefix → 62, bare local → 62-prefixed. */
export function canonPhone(v: string | null | undefined): string | null {
  const digits = (v ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  return "62" + digits;
}

export function isValidNik(v: string | null | undefined): boolean {
  return /^[0-9]{16}$/.test(v ?? "");
}

/** "BUDI SANTOSO" → "BU** SA*****" — enough for the patient to recognise themselves. */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w : w.slice(0, 2) + "*".repeat(w.length - 2)))
    .join(" ");
}

/** "1995-05-05" → "**-**-1995" (year only). */
export function maskDob(dob: string | null | undefined): string | null {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(dob ?? "");
  return m ? `**-**-${m[1]}` : null;
}

/** Reasonable DOB: parseable, in the past, age < 120. */
export function isValidTanggalLahir(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(v + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() + 1 !== Number(m[2])) return false;
  const now = new Date();
  if (d.getTime() > now.getTime()) return false;
  return now.getUTCFullYear() - d.getUTCFullYear() < 120;
}
