import { useRef } from "react";
import { Input } from "@/components/ui/input";

/** DD / MM / YYYY segmented date input (the vaksinadera StepDataDiri idiom). */
export default function DateSegments({
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
