// Public-page chrome, mirroring the vaksin app's branding: utility topbar (WA + telepon),
// sticky white navbar with the Klinik Adera logo, blue hero gradient, trust badges, footer.
import { CheckCircle2, MessageCircle, Phone } from "lucide-react";

const WA_URL = "https://wa.me/6281110152170";
const PHONE_DISPLAY = "0811 1015 2170";

export default function SiteChrome({
  eyebrow = "Klinik Adera",
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string | null;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen" style={{ background: "hsl(225 100% 97%)" }}>
      {/* Utility bar */}
      <div className="adera-topbar text-white text-xs">
        <div className="mx-auto flex max-w-6xl items-center justify-end px-6 py-2">
          <div className="flex items-center gap-4">
            <a
              href={WA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span>WhatsApp</span>
            </a>
            <a
              href="tel:+6281110152170"
              className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
            >
              <Phone className="h-3.5 w-3.5" />
              <span>{PHONE_DISPLAY}</span>
            </a>
          </div>
        </div>
      </div>

      {/* Navbar */}
      <nav className="sticky top-0 z-20 border-b border-border bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a href="https://klinikadera.co.id" target="_blank" rel="noopener noreferrer">
            <img src="/logo-adera.webp?v=1" alt="Klinik Adera" className="h-10 w-auto sm:h-12" />
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="adera-hero-bg border-b border-border/30 px-4 py-8 sm:py-10">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
            {eyebrow}
          </p>
          <h1 className="font-display text-2xl font-bold leading-tight text-primary sm:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-3 text-sm leading-relaxed text-foreground/70 sm:text-base">
              {subtitle}
            </p>
          )}
        </div>
      </section>

      {/* Content card */}
      <section className="px-4 pb-6 pt-5">
        <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
          {children}
        </div>
      </section>

      {/* Trust badges */}
      <section className="px-4 pb-10">
        <div className="mx-auto max-w-2xl">
          <div className="flex flex-wrap justify-center gap-2">
            {["Terhubung Sistem Klinik", "Konsultasi Dokter", "Akreditasi Paripurna"].map(
              (text) => (
                <span
                  key={text}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-white px-3 py-1.5 text-xs font-medium text-primary shadow-sm"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {text}
                </span>
              ),
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-white px-4 py-5">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 sm:flex-row">
          <a href="https://klinikadera.co.id" target="_blank" rel="noopener noreferrer">
            <img src="/logo-adera.webp?v=1" alt="Klinik Adera" className="h-7 w-auto opacity-75" />
          </a>
          <p className="text-center text-xs text-muted-foreground">
            © 2026 PT Keluarga Sehat Adera. Terdaftar di Kemenkes RI.
          </p>
          <a
            href={WA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {PHONE_DISPLAY}
          </a>
        </div>
      </footer>
    </main>
  );
}
