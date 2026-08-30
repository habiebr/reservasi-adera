import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

interface Seg {
  d: string;
  m: string;
  y: string;
}

const split = (v: string): Seg => {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return hit ? { d: hit[3], m: hit[2], y: hit[1] } : { d: "", m: "", y: "" };
};

/** A half-typed date has no spelling in YYYY-MM-DD, so it reads as "not filled in yet" — which
 *  is exactly what every caller already validates for. */
const compose = (s: Seg): string =>
  s.d && s.m && s.y.length === 4
    ? `${s.y}-${s.m.padStart(2, "0")}-${s.d.padStart(2, "0")}`
    : "";

/** DD / MM / YYYY segmented date input (the vaksinadera StepDataDiri idiom).
 *
 *  The segments are their own state rather than slices of `value`. Deriving them from the
 *  composed string meant every keystroke had to pad the other two: typing the first digit of
 *  the day emitted 0000-00-0X and the field read back "00/00/0000", so you were always
 *  clearing zeros before you could type the month. */
export default function DateSegments({
  value,
  onChange,
}: {
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
}) {
  const [seg, setSeg] = useState<Seg>(() => split(value));
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  // Only adopt `value` when it disagrees with what is typed — a lookup filling the patient in,
  // not our own emit echoing back. Comparing through compose() keeps a partial entry (which
  // emits "") from being wiped on every parent render.
  useEffect(() => {
    if (value !== compose(seg)) setSeg(split(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (patch: Partial<Seg>) => {
    const next = { ...seg, ...patch };
    setSeg(next);
    onChange(compose(next));
  };

  const field = (
    idx: number,
    val: string,
    max: number,
    placeholder: string,
    apply: (v: string) => void,
  ) => (
    <Input
      ref={refs[idx]}
      inputMode="numeric"
      autoComplete="off"
      value={val}
      placeholder={placeholder}
      maxLength={max}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, "").slice(0, max);
        apply(v);
        if (v.length === max && idx < 2) refs[idx + 1].current?.focus();
      }}
      onKeyDown={(e) => {
        // Backspace at an empty segment steps back, so correcting a typo does not need the mouse.
        if (e.key === "Backspace" && val === "" && idx > 0) {
          e.preventDefault();
          refs[idx - 1].current?.focus();
        }
      }}
      onFocus={(e) => e.target.select()}
      className="h-11 w-16 text-center font-mono tabular-nums sm:w-20"
    />
  );

  return (
    <div className="flex items-center gap-2">
      {field(0, seg.d, 2, "DD", (v) => update({ d: v }))}
      <span className="text-muted-foreground">/</span>
      {field(1, seg.m, 2, "MM", (v) => update({ m: v }))}
      <span className="text-muted-foreground">/</span>
      {field(2, seg.y, 4, "YYYY", (v) => update({ y: v }))}
    </div>
  );
}
