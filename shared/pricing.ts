// Pure pricing math. The server is the authority: it recomputes everything here from live
// Calq procedure data at create time; the wizard uses the same functions for display so the
// number the patient sees is the number DOKU charges.

export interface PricedItem {
  /** Calq procedure id, or a bundle uuid when the line represents a whole package. */
  procedureId: number | string;
  name: string;
  /** Calq price actually charged: specialPrice > 0 ? specialPrice : price */
  unitPrice: number;
  quantity: number;
  /** Calq per-procedure DP config (dpRule "calq") */
  isDownPayment?: boolean;
  downPaymentAmount?: number;
}

export interface DpConfig {
  dpEnabled: boolean;
  dpRule: "calq" | "fixed" | "percent";
  dpValue?: number;
}

export function totalAmount(items: PricedItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
}

/**
 * The DP amount for a selection, or null when DP is not offered.
 * - "calq": sum of each item's downPaymentAmount where isDownPayment, falling back to
 *   dpValue (flat) when no selected item defines one. Null when the result is 0.
 * - "fixed": dpValue rupiah (capped at the total).
 * - "percent": dpValue% of the total, rounded to the nearest 500.
 * A DP equal to or above the total is meaningless → null (the patient just pays lunas).
 */
export function dpAmount(items: PricedItem[], cfg: DpConfig): number | null {
  if (!cfg.dpEnabled) return null;
  const total = totalAmount(items);
  if (total <= 0) return null;

  let dp = 0;
  if (cfg.dpRule === "calq") {
    dp = items.reduce(
      (sum, i) => sum + (i.isDownPayment ? (i.downPaymentAmount ?? 0) * i.quantity : 0),
      0,
    );
    if (dp <= 0) dp = cfg.dpValue ?? 0;
  } else if (cfg.dpRule === "fixed") {
    dp = cfg.dpValue ?? 0;
  } else {
    const pct = cfg.dpValue ?? 0;
    dp = Math.round((total * pct) / 100 / 500) * 500;
  }

  if (dp <= 0 || dp >= total) return null;
  return dp;
}

/** What DOKU charges now. DOKU rejects 0, hence the floor of 1. */
export function amountDue(
  items: PricedItem[],
  cfg: DpConfig,
  jenisPembayaran: "LUNAS" | "DP",
): number {
  const total = totalAmount(items);
  if (jenisPembayaran === "DP") {
    const dp = dpAmount(items, cfg);
    if (dp !== null) return Math.max(dp, 1);
  }
  return Math.max(total, 1);
}

export function formatRupiah(value: number): string {
  return "Rp " + new Intl.NumberFormat("id-ID").format(value);
}
