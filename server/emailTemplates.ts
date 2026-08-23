// Invoice email in the approved Klinik Adera layout (table-based, 600px, inline styles,
// brand-blue header) — the vaksinadera campaign layout extended with a line-item table.
import { formatRupiah } from "@shared/pricing.ts";

const BRAND_BLUE = "#0033FF";

export interface InvoiceEmailInput {
  nama: string;
  invoiceNumber: string;
  saleInvoiceNumber?: string | null;
  bookingCode?: string | null;
  queueNumber?: string | null;
  poli?: string | null;
  dokter?: string | null;
  tanggal: string; // already formatted, e.g. "Senin, 25 Agustus 2026"
  jam?: string | null;
  items: { name: string; unitPrice: number; quantity: number }[];
  totalAmount: number;
  jenisPembayaran: "LUNAS" | "DP";
  paidAmount: number;
  siteUrl?: string;
  contactPhone?: string;
}

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderInvoiceEmail(input: InvoiceEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const sisa = input.totalAmount - input.paidAmount;
  const detailRows: [string, string][] = [
    ["No. Invoice", input.invoiceNumber],
    ...(input.saleInvoiceNumber ? [["Invoice Klinik", input.saleInvoiceNumber] as [string, string]] : []),
    ...(input.bookingCode ? [["Kode Booking", input.bookingCode] as [string, string]] : []),
    ...(input.queueNumber ? [["Nomor Antrean", input.queueNumber] as [string, string]] : []),
    ...(input.poli ? [["Poli", input.poli] as [string, string]] : []),
    ...(input.dokter ? [["Dokter", input.dokter] as [string, string]] : []),
    ["Tanggal Kunjungan", input.tanggal],
    ...(input.jam ? [["Jam", input.jam] as [string, string]] : []),
  ];

  const itemRowsHtml = input.items
    .map(
      (i) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #E6EAF2;font-size:14px;color:#1F2937;">
          ${esc(i.name)}${i.quantity > 1 ? ` &times;${i.quantity}` : ""}
        </td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #E6EAF2;font-size:14px;color:#1F2937;white-space:nowrap;">
          ${formatRupiah(i.unitPrice * i.quantity)}
        </td>
      </tr>`,
    )
    .join("");

  const totalsRows: [string, string, boolean][] = [
    ["Total", formatRupiah(input.totalAmount), false],
    [
      input.jenisPembayaran === "DP" ? "DP Dibayar" : "Dibayar",
      formatRupiah(input.paidAmount),
      false,
    ],
    ...(sisa > 0 ? [["Sisa (dibayar di klinik)", formatRupiah(sisa), true] as [string, string, boolean]] : []),
  ];
  const totalsHtml = totalsRows
    .map(
      ([label, value, warn]) => `
      <tr>
        <td style="padding:6px 0;font-size:14px;font-weight:${label === "Total" ? 700 : 500};color:${warn ? "#B45309" : "#111827"};">${esc(label)}</td>
        <td align="right" style="padding:6px 0;font-size:14px;font-weight:${label === "Total" ? 700 : 500};color:${warn ? "#B45309" : "#111827"};white-space:nowrap;">${esc(value)}</td>
      </tr>`,
    )
    .join("");

  const detailHtml = detailRows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:6px 0;font-size:13px;color:#64748B;vertical-align:top;">${esc(label)}</td>
        <td align="right" style="padding:6px 0;font-size:13px;color:#111827;font-weight:600;">${esc(value)}</td>
      </tr>`,
    )
    .join("");

  const note = input.jenisPembayaran === "DP"
    ? "Tunjukkan kode booking saat kedatangan. Sisa pembayaran dilunasi di klinik."
    : "Tunjukkan kode booking saat kedatangan.";

  // PNG on purpose: Outlook cannot render webp (same lesson as the vaksin app's mail logo).
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
  const logoUrl = appUrl ? `${appUrl}/logo-adera.png` : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#F1F5F9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
  <tr><td style="background:${BRAND_BLUE};padding:18px 28px;">
    ${
    logoUrl
      ? `<img src="${logoUrl}" alt="Klinik Adera" height="36" style="display:block;height:36px;width:auto;" />`
      : `<span style="color:#FFFFFF;font-size:18px;font-weight:700;">Klinik Adera</span>`
  }
  </td></tr>
  <tr><td style="padding:28px;">
    <div style="display:inline-block;background:#DCFCE7;color:#15803D;font-size:11px;font-weight:700;letter-spacing:.08em;padding:4px 10px;border-radius:999px;">PEMBAYARAN DITERIMA</div>
    <h1 style="margin:16px 0 4px;font-size:20px;color:#111827;">Reservasi Anda terkonfirmasi</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#374151;">Halo ${esc(input.nama)}, pembayaran Anda sudah kami terima. Berikut rincian kunjungan Anda.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E6EAF2;border-radius:10px;padding:4px 16px;">
      ${detailHtml}
    </table>
    <h2 style="margin:24px 0 8px;font-size:14px;color:#111827;">Rincian Biaya</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${itemRowsHtml}
      ${totalsHtml}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;">
      <tr><td style="padding:12px 16px;font-size:13px;color:#92400E;">${esc(note)}</td></tr>
    </table>
    ${
    input.contactPhone
      ? `<p style="margin:20px 0 0;font-size:13px;color:#64748B;">Pertanyaan? Hubungi kami di ${esc(input.contactPhone)}.</p>`
      : ""
  }
  </td></tr>
  <tr><td style="background:#F8FAFC;border-top:1px solid #E6EAF2;padding:16px 28px;font-size:12px;color:#94A3B8;">
    Email ini dikirim otomatis oleh sistem reservasi Klinik Adera.
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const text = [
    `Reservasi Anda terkonfirmasi`,
    ``,
    `Halo ${input.nama}, pembayaran Anda sudah kami terima.`,
    ``,
    ...detailRows.map(([l, v]) => `${l}: ${v}`),
    ``,
    `Rincian biaya:`,
    ...input.items.map((i) =>
      `- ${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ""}: ${formatRupiah(i.unitPrice * i.quantity)}`
    ),
    ...totalsRows.map(([l, v]) => `${l}: ${v}`),
    ``,
    note,
  ].join("\n");

  return {
    subject: `Reservasi terkonfirmasi — ${input.bookingCode ?? input.invoiceNumber}`,
    html,
    text,
  };
}
