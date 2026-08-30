// The bare domain belongs to patients. One form owns it and is rendered here outright — a
// menu of services followed by the wizard's own "Pilih Poli" made the patient choose the
// same thing twice, which is exactly the seam this avoids. The list only appears while no
// form has claimed the slot, so "/" always leads somewhere. Admin lives at /admin and is
// not linked from here: staff know the address, patients need not meet a login screen.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import SiteChrome from "@/components/SiteChrome";
import VisitForm from "./VisitForm";

interface FormLink {
  slug: string;
  title: string;
  description: string | null;
}

export default function Home() {
  const [forms, setForms] = useState<FormLink[] | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiGet<{ home: string | null; forms: FormLink[] }>("/api/forms")
      .then((r) => {
        setHome(r.home);
        setForms(r.forms);
      })
      .catch(() => setFailed(true));
  }, []);

  // Straight into the wizard, chrome and all — indistinguishable from opening /{slug}.
  if (home) return <VisitForm slug={home} />;

  // Until the answer lands we do not know whether this is a form or a list, so borrow the
  // form page's own loading title rather than flashing a heading we may be about to drop.
  if (!forms && !failed) {
    return (
      <SiteChrome title="Memuat…">
        <div className="space-y-4">
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </SiteChrome>
    );
  }

  return (
    <SiteChrome
      title="Reservasi Kunjungan"
      subtitle="Pilih layanan yang ingin Anda reservasi, lalu tentukan dokter dan jadwalnya."
    >
      {failed && (
        <p className="text-center text-sm text-muted-foreground">
          Daftar layanan sedang tidak bisa dimuat. Silakan muat ulang halaman ini.
        </p>
      )}
      {forms?.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          Belum ada layanan reservasi yang dibuka. Silakan hubungi klinik lewat WhatsApp di
          nomor pada bagian atas halaman.
        </p>
      )}
      {forms && forms.length > 0 && (
        <div className="space-y-3">
          {forms.map((f) => (
            <Link
              key={f.slug}
              to={`/${f.slug}`}
              className="flex items-center gap-3 rounded-xl border-2 border-border bg-card p-4 transition-all hover:border-primary/60"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                <CalendarCheck className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{f.title}</span>
                {f.description && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {f.description}
                  </span>
                )}
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
            </Link>
          ))}
        </div>
      )}
    </SiteChrome>
  );
}
