import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { FormBranding, FormDefinition } from "@shared/formTypes";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import WizardRenderer from "@/components/wizard/WizardRenderer";

interface PublicForm {
  slug: string;
  title: string;
  branding: FormBranding;
  definition: FormDefinition;
}

export default function VisitForm() {
  const { slug = "" } = useParams();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    apiGet<PublicForm>(`/api/forms/${slug}`)
      .then(setForm)
      .catch(() => setNotFound(true));
  }, [slug]);

  return (
    <div className="min-h-screen bg-background">
      <header className="adera-hero-bg">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Klinik Adera
          </p>
          <h1 className="mt-1 font-display text-2xl font-extrabold text-foreground sm:text-3xl">
            {notFound ? "Form tidak ditemukan" : form?.branding.headline || form?.title || "Memuat…"}
          </h1>
          {form?.branding.description && (
            <p className="mt-2 text-sm text-muted-foreground">{form.branding.description}</p>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-16">
        <div className="-mt-2 rounded-2xl border border-border bg-card p-5 shadow-md sm:p-8">
          {notFound && (
            <p className="text-center text-sm text-muted-foreground">
              Tautan reservasi ini tidak tersedia atau sudah ditutup.
            </p>
          )}
          {!notFound && !form && (
            <div className="space-y-4">
              <Skeleton className="h-8 w-full rounded-lg" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </div>
          )}
          {form && (
            <WizardRenderer
              slug={form.slug}
              definition={form.definition}
              branding={form.branding}
            />
          )}
        </div>
      </main>
    </div>
  );
}
