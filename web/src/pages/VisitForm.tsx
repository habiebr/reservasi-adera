import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { FormBranding, FormDefinition } from "@shared/formTypes";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import SiteChrome from "@/components/SiteChrome";
import WizardRenderer from "@/components/wizard/WizardRenderer";

interface PublicForm {
  slug: string;
  title: string;
  branding: FormBranding;
  definition: FormDefinition;
}

/**
 * Keeps the parent page's iframe as tall as the wizard. The host script (copied from the
 * builder) listens for this; a host that ignores it just gets a fixed-height frame that
 * scrolls internally, so nothing breaks when the snippet is pasted incompletely.
 */
function useReportHeight(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  // The app paints its own page background; inside a host page that would show as a stray
  // panel behind the card. Let the host's own background come through instead.
  useLayoutEffect(() => {
    if (!enabled) return;
    const { body, documentElement } = document;
    const prev = [body.style.background, documentElement.style.background] as const;
    body.style.background = "transparent";
    documentElement.style.background = "transparent";
    return () => {
      body.style.background = prev[0];
      documentElement.style.background = prev[1];
    };
  }, [enabled]);

  useLayoutEffect(() => {
    if (!enabled || !ref.current || window.parent === window.self) return;
    const send = () => {
      const height = Math.ceil(ref.current!.getBoundingClientRect().height);
      window.parent.postMessage({ type: "adera-reservasi:height", height }, "*");
    };
    const obs = new ResizeObserver(send);
    obs.observe(ref.current);
    send();
    return () => obs.disconnect();
  }, [enabled]);
  return ref;
}

export default function VisitForm({ slug: fixedSlug }: { slug?: string } = {}) {
  const { slug: routeSlug = "" } = useParams();
  const slug = fixedSlug ?? routeSlug;
  const [params] = useSearchParams();
  const embedded = params.get("embed") === "1";
  const [form, setForm] = useState<PublicForm | null>(null);
  const [notFound, setNotFound] = useState(false);
  const heightRef = useReportHeight(embedded);

  useEffect(() => {
    apiGet<PublicForm>(`/api/forms/${slug}`)
      .then(setForm)
      .catch(() => setNotFound(true));
  }, [slug]);

  const missing = (
    <p className="text-center text-sm text-muted-foreground">
      Tautan reservasi ini tidak tersedia atau sudah ditutup.
    </p>
  );
  const loading = (
    <div className="space-y-4">
      <Skeleton className="h-8 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );

  // Embedded: no topbar, hero, badges or footer — the host page already has its own. The
  // card keeps its padding so the wizard's sticky footer still tucks into a rounded corner.
  if (embedded) {
    return (
      <div ref={heightRef} className="p-1">
        <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
          {notFound ? missing : !form ? loading : (
            <WizardRenderer
              slug={form.slug}
              definition={form.definition}
              branding={form.branding}
              embedded
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <SiteChrome
      title={notFound ? "Form tidak ditemukan" : form?.branding.headline || form?.title || "Memuat…"}
      subtitle={form?.branding.description}
    >
      {notFound && missing}
      {!notFound && !form && loading}
      {form && (
        <WizardRenderer slug={form.slug} definition={form.definition} branding={form.branding} />
      )}
    </SiteChrome>
  );
}
