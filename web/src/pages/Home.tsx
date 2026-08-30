// The bare domain belongs to patients: a list of the reservations they can start. Admin
// lives at /admin and is not linked from here — staff know the address, patients do not
// need to meet a login screen.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import SiteChrome from "@/components/SiteChrome";

interface FormLink {
  slug: string;
  title: string;
  description: string | null;
}

export default function Home() {
  const [forms, setForms] = useState<FormLink[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiGet<{ forms: FormLink[] }>("/api/forms")
      .then((r) => setForms(r.forms))
      .catch(() => setFailed(true));
  }, []);

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
      {!failed && !forms && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
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
