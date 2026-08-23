import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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
    <SiteChrome
      title={notFound ? "Form tidak ditemukan" : form?.branding.headline || form?.title || "Memuat…"}
      subtitle={form?.branding.description}
    >
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
        <WizardRenderer slug={form.slug} definition={form.definition} branding={form.branding} />
      )}
    </SiteChrome>
  );
}
