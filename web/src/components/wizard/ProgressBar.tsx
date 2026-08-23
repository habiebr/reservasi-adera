import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ProgressBar({
  current,
  total,
  labels,
}: {
  current: number; // 1-based
  total: number;
  labels: string[];
}) {
  return (
    <div className="relative">
      <div className="absolute left-4 right-4 top-4 h-0.5 bg-border" aria-hidden />
      <div
        className="absolute left-4 top-4 h-0.5 bg-primary transition-all duration-300"
        style={{ width: total > 1 ? `calc(${((current - 1) / (total - 1)) * 100}% - 2rem)` : 0 }}
        aria-hidden
      />
      <ol className="relative flex justify-between">
        {Array.from({ length: total }, (_, i) => {
          const step = i + 1;
          const done = step < current;
          const active = step === current;
          return (
            <li key={step} className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all",
                  done
                    ? "border-primary bg-primary text-primary-foreground"
                    : active
                      ? "border-primary bg-card text-primary ring-4 ring-primary/20"
                      : "border-border bg-card text-muted-foreground",
                )}
              >
                {done ? <Check className="h-4 w-4" /> : step}
              </span>
              <span
                className={cn(
                  "hidden max-w-20 text-center text-[11px] leading-tight sm:block",
                  active ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {labels[i]}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
