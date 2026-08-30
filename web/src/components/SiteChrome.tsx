// Public-page chrome, rebuilt from the Klinik Adera Figma file — page "UI FIX (READY)",
// section Dokter, frames "Choose" (desktop 2656:58035) and "Choose Doker" (mobile
// 2656:58931). Everything outside the content slot is the clinic's real site furniture:
// utility bar, navbar, banner, footer. The slot itself carries the reservation wizard,
// standing where Figma puts its doctor list.

import { Link } from "react-router-dom";

const SITE = "https://klinikadera.co.id";

// Every contact detail the chrome prints, in one place. These are the numbers written in
// the Figma footer. Note the WhatsApp line differs from the 0811 1015 2170 this app used
// before — if that older number is the staffed one, change it back here and nowhere else.
const CONTACT = {
  phone: "(0274) 2888800",
  phoneHref: "tel:+622742888800",
  whatsapp: "0811 276 220",
  whatsappHref: "https://wa.me/62811276220",
  telegram: "0811 334 444 14",
};

const FOOTER_COLUMNS = [
  { title: "Layanan", items: ["Poli Umum", "Poli KIA", "Poli KB", "Poli Gigi", "Laboratorium"] },
  {
    title: "Program",
    items: [
      "Medical Chek up",
      "Home Care",
      "Sunat Racing",
      "Hemodialisa",
      "Vaksinasi",
      "Senam Kehamilan",
      "Layanan Laktasi",
    ],
  },
  { title: "Tautan", items: ["Fasilitas", "Berita", "Dokter", "Promo"] },
];

// Payment marks, split into the two columns the Figma footer uses. `w`/`h` are the box
// each mark gets. Several exports are bigger sheets that the design crops to a window
// rather than whole logos, so those carry `crop` — the frame's own offsets, verbatim.
// Without it they render as an unreadable shrunk-down sheet.
type Pay = {
  src: string;
  alt: string;
  label: string | null;
  w: number;
  h: number;
  crop?: { width: string; height: string; left: string; top: string };
};
const PAY_LEFT: Pay[] = [
  { src: "/adera/icon-cash.svg", alt: "Tunai", label: "Tunai", w: 40, h: 40 },
  { src: "/adera/pay-bpjs.png", alt: "BPJS Kesehatan", label: "BPJS\nKesehatan", w: 48, h: 44 },
  {
    src: "/adera/pay-mandiri.png",
    alt: "Bank Mandiri",
    label: null,
    w: 130,
    h: 44,
    crop: { width: "100%", height: "148%", left: "0", top: "-24%" },
  },
  {
    src: "/adera/pay-bri.png",
    alt: "Bank BRI",
    label: null,
    w: 134,
    h: 38,
    crop: { width: "122.7%", height: "432.43%", left: "-11.81%", top: "-162.16%" },
  },
];
const PAY_RIGHT: Pay[] = [
  {
    src: "/adera/pay-gopay.png",
    alt: "Gopay",
    label: "Gopay",
    w: 41,
    h: 40,
    crop: { width: "431.46%", height: "249.42%", left: "0", top: "-73.56%" },
  },
  { src: "/adera/pay-qris.png", alt: "QRIS", label: null, w: 109, h: 40 },
  {
    src: "/adera/pay-bsi.png",
    alt: "Bank Syariah Indonesia",
    label: null,
    w: 122,
    h: 40,
    crop: { width: "172.97%", height: "296.7%", left: "-38.02%", top: "-102.2%" },
  },
];

// Icons are exported from Figma rather than drawn here. No href: the clinic's actual
// social handles are not in the design file, and an icon linking nowhere is worse than
// one that plainly is not a link. Add `href` to turn them into links.
// The banner's three stat cards, as written in the Figma banner and confirmed for use.
const DEFAULT_STATS = [
  { label: "Jumlah Dokter", value: "12+" },
  { label: "Total Pasien", value: "1.200+" },
  { label: "Jadwal Praktik", value: "24/7" },
];

const SOCIALS = [
  { src: "/adera/icon-instagram.svg", alt: "Instagram" },
  { src: "/adera/icon-tiktok.svg", alt: "TikTok" },
  { src: "/adera/icon-facebook.svg", alt: "Facebook" },
  { src: "/adera/icon-linkedin.svg", alt: "LinkedIn" },
];

export default function SiteChrome({
  eyebrow = "Klinik Adera",
  title,
  subtitle,
  stats = DEFAULT_STATS,
  showQueueLink = true,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string | null;
  /** Banner stat cards. Defaults to the figures in the Figma banner; pass `[]` to drop
   *  them on a page where they do not belong. */
  stats?: { label: string; value: string }[];
  /** The Cek Antrean link. Off on the Cek Antrean page itself, which would self-link. */
  showQueueLink?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background">
      {/* Utility bar. Pared back to the one line a patient actually wants; the rest of
          the design's row (WhatsApp, ID, Masuk/Daftar) is dropped for now. */}
      <div className="adera-topbar text-white">
        <div className="mx-auto flex max-w-[1328px] items-center justify-end px-4 py-2.5 sm:px-6">
          <a
            href={CONTACT.phoneHref}
            className="flex items-center gap-2 text-xs font-semibold tracking-[-0.02em] hover:opacity-80 sm:text-sm"
          >
            <img src="/adera/icon-phone-badge.svg" alt="" className="h-5 w-5 shrink-0" />
            <span className="whitespace-nowrap">Hubungi kami {CONTACT.phone}</span>
          </a>
        </div>
      </div>

      {/* Navbar. Section links are intentionally left out for now — the reservation
          flow is the whole page, and the clinic's own site owns that navigation. */}
      <nav className="sticky top-0 z-20 bg-white shadow-sm">
        <div className="mx-auto flex max-w-[1328px] items-center px-4 py-3 sm:px-6">
          <a href={SITE} target="_blank" rel="noopener noreferrer" className="shrink-0">
            <img
              src="/adera/logo-adera-color.png"
              alt="Klinik Adera"
              className="h-10 w-auto sm:h-[50px]"
            />
          </a>
        </div>
      </nav>

      {/* Banner. The doctor cutout is decorative and drops out below lg, where the
          heading needs the full width more than the page needs the photograph. */}
      <section className="adera-hero-bg">
        <div className="mx-auto flex max-w-[1328px] items-center justify-between gap-6 px-4 py-8 sm:px-6 lg:py-6">
          <div className="flex w-full flex-col gap-6 lg:w-[711px] lg:gap-10">
            <div className="flex flex-col items-start gap-3">
              {eyebrow && (
                <span className="rounded-xl bg-[#FFB700] p-3 text-sm font-medium leading-none text-primary sm:text-[17px]">
                  {eyebrow}
                </span>
              )}
              <h1 className="text-[28px] font-semibold leading-[1.2] text-[#1869BA] sm:text-4xl lg:text-[56px]">
                {title}
              </h1>
              {subtitle && (
                <p className="text-base leading-[1.35] text-[#353535] sm:text-lg lg:text-2xl">
                  {subtitle}
                </p>
              )}
            </div>

            {stats && stats.length > 0 && (
              <div className="flex gap-3 text-white">
                {stats.map((s) => (
                  <div
                    key={s.label}
                    className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl bg-[#55B0FF] p-3 lg:gap-4"
                  >
                    <p className="text-xs leading-[1.2] sm:text-sm lg:text-2xl">{s.label}</p>
                    <p className="text-2xl font-semibold leading-[1.2] lg:text-[44px]">{s.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <img
            src="/adera/banner-doctor.png"
            alt=""
            aria-hidden
            className="hidden max-h-[420px] w-auto shrink-0 self-end object-contain xl:max-h-[520px] lg:block"
          />
        </div>
      </section>

      {/* Content card — the reservation wizard sits here, where Figma lists doctors. */}
      <section className="px-4 pb-6 pt-5 sm:px-6">
        <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
          {children}
        </div>

        {showQueueLink && (
          <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-muted-foreground">
            Sudah pernah reservasi?{" "}
            <Link to="/antrean" className="font-medium text-primary hover:underline">
              Cek nomor antrean
            </Link>
          </p>
        )}
      </section>

      {/* Footer */}
      <footer className="bg-brand-navy px-4 py-6 text-white sm:px-8 lg:px-[70px]">
        <div className="mx-auto max-w-[1328px]">
          <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
            {/* Address + direct lines */}
            <div className="flex w-full flex-col gap-4 lg:w-[275px]">
              <img
                src="/adera/logo-adera-white.png"
                alt="Klinik Adera"
                className="h-14 w-[157px] object-contain"
              />
              <p className="text-sm leading-[1.2]">
                Jl. PJKA No.3, RT.06/RW.34, Jaban
                <br />
                Kalurahan Tridadi
                <br />
                Kapanewon Sleman
                <br />
                Kabupaten Sleman
                <br />
                Daerah Istimewa Yogyakarta (55511)
              </p>
              <dl className="flex flex-col gap-2 text-sm leading-[1.2]">
                {[
                  { icon: "/adera/icon-telephone.svg", label: "Telepon", value: CONTACT.phone },
                  { icon: "/adera/icon-wa-line.svg", label: "WhatsApp", value: CONTACT.whatsapp },
                  { icon: "/adera/icon-telegram.svg", label: "Telegram", value: CONTACT.telegram },
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-2">
                    <img src={row.icon} alt="" className="h-[17px] w-[17px] shrink-0" />
                    <dt className="w-[69px] shrink-0">{row.label}</dt>
                    <span aria-hidden>:</span>
                    <dd className="font-semibold">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="flex w-full flex-col gap-3 lg:w-[892px]">
              <div className="flex flex-wrap gap-8 lg:flex-nowrap lg:gap-20">
                {FOOTER_COLUMNS.map((col) => (
                  <div key={col.title} className="flex flex-col">
                    <p className="p-2.5 text-[17px] font-medium leading-[1.2]">{col.title}</p>
                    {col.items.map((item) => (
                      <span
                        key={item}
                        className="whitespace-nowrap p-2.5 text-sm leading-[1.2] opacity-80"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ))}

                <div className="flex w-full flex-col lg:w-[325px]">
                  <p className="p-2.5 text-[17px] font-medium leading-[1.2]">Pembayaran</p>
                  <div className="flex gap-2">
                    {[PAY_LEFT, PAY_RIGHT].map((column, i) => (
                      <div key={i} className="flex flex-col gap-2">
                        {column.map((p) => (
                          <div key={p.alt} className="flex h-[50px] items-center px-2.5">
                            <span
                              style={{ width: p.w, height: p.h }}
                              className="relative block shrink-0 overflow-hidden"
                            >
                              <img
                                src={p.src}
                                alt={p.alt}
                                className="absolute max-w-none object-contain"
                                style={p.crop ?? { inset: 0, width: "100%", height: "100%" }}
                              />
                            </span>
                            {p.label && (
                              <span className="whitespace-pre px-2.5 text-[15px] font-semibold leading-[1.2] opacity-80">
                                {p.label}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-start justify-between gap-8">
                <div className="flex w-[200px] flex-col justify-center gap-7">
                  <p className="text-[11px] leading-[1.2]">Ikuti media sosial kami</p>
                  <div className="flex items-center gap-6">
                    {SOCIALS.map((s) => (
                      <img key={s.alt} src={s.src} alt={s.alt} className="h-6 w-6" />
                    ))}
                  </div>
                </div>
                <div className="flex w-[200px] flex-col gap-7">
                  <p className="text-[11px] leading-[1.2]">Jejaring kami</p>
                  <div className="flex h-[38px] items-start gap-6">
                    <img
                      src="/adera/net-pratama.png"
                      alt="Klinik Pratama Adera"
                      className="h-[37px] w-[88px] object-contain"
                    />
                    <img
                      src="/adera/net-utama.png"
                      alt="Klinik Utama Adera"
                      className="h-10 w-[79px] object-contain"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-center gap-[30px]">
            <div className="h-px w-full bg-white opacity-15" />
            <p className="text-center text-[11px] leading-[1.2] opacity-75">
              © 2026 AderaMedia | All Rights Reserved{" "}
              {/* Which build this tab is actually running — a stale shell is otherwise
                  indistinguishable from a deploy that never happened. */}
              <span className="opacity-40">v{__BUILD_ID__}</span>
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
