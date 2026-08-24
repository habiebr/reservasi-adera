import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlockProps } from "./types";

/** Ya/Tidak screening questions. A question's blockAnswer stops the flow with a warning —
 * the Lanjut button stays disabled via nextHint. */
export default function ScreeningBlock({ block, data, update }: BlockProps) {
  const questions = block.config.screeningQuestions ?? [];
  if (questions.length === 0) return null;

  return (
    <div className="space-y-3">
      {questions.map((q, idx) => {
        const answer = data.answers[q.id] ?? "";
        const blocked = Boolean(q.blockAnswer) && answer === q.blockAnswer;
        return (
          <div
            key={q.id}
            className={cn(
              "rounded-xl border-2 p-4 transition-colors",
              blocked ? "border-destructive/50 bg-destructive/5" : "border-border bg-card",
            )}
          >
            <p className="text-sm font-medium text-foreground">
              {idx + 1}. {q.text}
            </p>
            <div className="mt-2.5 flex gap-2" role="radiogroup" aria-label={q.text}>
              {(["Ya", "Tidak"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  role="radio"
                  aria-checked={answer === opt}
                  onClick={() => update({ answers: { ...data.answers, [q.id]: opt } })}
                  className={cn(
                    "h-10 w-24 rounded-lg border-2 text-sm font-medium transition-all",
                    answer === opt
                      ? "border-primary bg-primary-muted text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/60",
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
            {blocked && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {q.blockMessage?.trim() ||
                  "Berdasarkan jawaban ini, reservasi online tidak dapat dilanjutkan. Silakan hubungi klinik untuk penanganan lebih lanjut."}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
