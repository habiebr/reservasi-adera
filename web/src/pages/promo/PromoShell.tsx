import type { ReactNode } from "react";

/** Promo pages are phone-width on every screen (owner: "fix mobile size walaupun dari web"). */
export default function PromoShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#EEF1F7]" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-white text-[#0F2557] shadow-[0_0_40px_rgba(15,37,87,0.08)]">
        <div className="flex h-11 items-center justify-end bg-[#0033FF] px-4 text-[13px] font-semibold text-white">
          <a href="https://wa.me/6281110152170" className="text-white no-underline">Hubungi kami 0811-1015-2170</a>
        </div>
        <header className="flex h-[72px] items-center border-b border-[#E6EAF2] px-4">
          <a href="https://vaksinadera.co.id/11-11">
            <img src="/promo/logo-vaksin-adera.png" alt="Vaksin Adera" className="h-10 w-auto" />
          </a>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
        <footer className="mt-auto flex flex-col gap-1 bg-[#0F2557] px-4 py-6 text-[13px] text-[#C9D3EE]">
          <strong className="text-[15px] text-white">Klinik Pratama Adera</strong>
          <span>Sleman, Yogyakarta · WhatsApp 0811-1015-2170</span>
        </footer>
      </div>
    </div>
  );
}

export const rupiah = (n: number) => "Rp" + n.toLocaleString("id-ID");
