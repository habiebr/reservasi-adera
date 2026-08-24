// Paket (bundle) catalog: admin-curated packages combining Calq procedures under a custom
// display name. Prices are never stored — priceBundles() attaches live Calq prices so every
// consumer (admin list, public wizard, booking create) sees the same number.
import { sql } from "./db.ts";
import {
  getCalqProducts,
  getProcedures,
  procedurePrice,
  type CalqCreds,
  type CalqProcedure,
  type CalqProduct,
} from "./calq.ts";

/** Calq sale-item kinds this app can bill. Appointments only carry PROCEDURE ids. */
export type ReferenceType = "PROCEDURE" | "PRODUCT";

export function productPrice(p: CalqProduct): number {
  const special = Number(p.specialPrice ?? 0);
  const base = Number(p.sellingPrice ?? 0);
  return special > 0 ? special : base;
}

export interface BundleItem {
  referenceType: ReferenceType;
  procedureId: number; // procedure id, or product id when referenceType is PRODUCT
  procedureName: string;
  quantity: number;
}

export interface Bundle {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  items: BundleItem[];
}

export interface PricedBundleItem extends BundleItem {
  unitPrice: number;
  isDownPayment: boolean;
  downPaymentAmount: number;
  missing: boolean; // procedure no longer active/priced in Calq
}

export interface PricedBundle extends Bundle {
  price: number;
  items: PricedBundleItem[];
  /** aggregated per-item Calq DP config (dpRule "calq") */
  isDownPayment: boolean;
  downPaymentAmount: number;
  /** false when any underlying procedure is inactive or unpriced in Calq */
  available: boolean;
}

export async function listBundles(opts: { activeOnly?: boolean; ids?: string[] } = {}): Promise<
  Bundle[]
> {
  const rows = await sql`
    SELECT id, name, description, active FROM bundles
    WHERE (${opts.activeOnly ? 1 : 0} = 0 OR active)
      ${opts.ids && opts.ids.length > 0 ? sql`AND id IN ${sql(opts.ids)}` : sql``}
    ORDER BY name`;
  if (rows.length === 0) return [];
  const items = await sql`
    SELECT bundle_id, procedure_id, procedure_name, quantity, reference_type
    FROM bundle_items WHERE bundle_id IN ${sql(rows.map((r) => r.id as string))}
    ORDER BY sort_order`;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    active: Boolean(r.active),
    items: items
      .filter((i) => i.bundle_id === r.id)
      .map((i) => ({
        referenceType: (i.reference_type as ReferenceType) ?? "PROCEDURE",
        procedureId: Number(i.procedure_id),
        procedureName: i.procedure_name as string,
        quantity: Number(i.quantity),
      })),
  }));
}

/** Attach live Calq prices + DP config. Pass pre-fetched catalogs to share one fetch. */
export function priceBundles(
  bundles: Bundle[],
  procedures: CalqProcedure[],
  products: CalqProduct[] = [],
): PricedBundle[] {
  const procById = new Map(procedures.filter((p) => p.isActive).map((p) => [p.id, p]));
  const prodById = new Map(products.filter((p) => !p.deletedAt).map((p) => [p.id, p]));
  return bundles.map((b) => {
    const items: PricedBundleItem[] = b.items.map((i) => {
      if (i.referenceType === "PRODUCT") {
        const prod = prodById.get(i.procedureId);
        const unitPrice = prod ? productPrice(prod) : 0;
        return {
          ...i,
          procedureName: prod?.name ?? i.procedureName,
          unitPrice,
          // products carry no Calq DP config
          isDownPayment: false,
          downPaymentAmount: 0,
          missing: !prod || unitPrice <= 0,
        };
      }
      const proc = procById.get(i.procedureId);
      const unitPrice = proc ? procedurePrice(proc) : 0;
      return {
        ...i,
        procedureName: proc?.name ?? i.procedureName,
        unitPrice,
        isDownPayment: Boolean(proc?.isDownPayment),
        downPaymentAmount: Number(proc?.downPaymentAmount ?? 0),
        missing: !proc || unitPrice <= 0,
      };
    });
    const price = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const downPaymentAmount = items.reduce(
      (sum, i) => sum + (i.isDownPayment ? i.downPaymentAmount * i.quantity : 0),
      0,
    );
    return {
      ...b,
      items,
      price,
      isDownPayment: downPaymentAmount > 0,
      downPaymentAmount,
      available: items.length > 0 && items.every((i) => !i.missing),
    };
  });
}

export async function pricedBundles(
  creds: CalqCreds,
  opts: { activeOnly?: boolean; ids?: string[] } = {},
): Promise<PricedBundle[]> {
  const bundles = await listBundles(opts);
  if (bundles.length === 0) return [];
  // bundles may span specializations, and may mix procedures with products
  const [procedures, products] = await Promise.all([
    getProcedures(creds),
    getCalqProducts(creds).catch(() => [] as CalqProduct[]),
  ]);
  return priceBundles(bundles, procedures, products);
}

/**
 * Collapse booking_items rows into patient-facing lines: rows that came from the same
 * bundle become one line under the bundle's name; standalone procedures pass through.
 */
export function groupBookingItemRows(
  rows: readonly Record<string, unknown>[],
): { name: string; unitPrice: number; quantity: number }[] {
  const lines: { name: string; unitPrice: number; quantity: number }[] = [];
  const byBundle = new Map<string, { name: string; unitPrice: number; quantity: number }>();
  for (const r of rows) {
    const amount = Number(r.unit_price) * Number(r.quantity);
    const bundleId = r.bundle_id ? String(r.bundle_id) : null;
    if (!bundleId) {
      lines.push({
        name: String(r.procedure_name),
        unitPrice: Number(r.unit_price),
        quantity: Number(r.quantity),
      });
      continue;
    }
    const existing = byBundle.get(bundleId);
    if (existing) {
      existing.unitPrice += amount;
    } else {
      const line = {
        name: String(r.bundle_name ?? r.procedure_name),
        unitPrice: amount,
        quantity: 1,
      };
      byBundle.set(bundleId, line);
      lines.push(line);
    }
  }
  return lines;
}

export interface BundleInput {
  name: string;
  description?: string;
  active?: boolean;
  items: {
    referenceType: ReferenceType;
    procedureId: number;
    procedureName?: string;
    quantity?: number;
  }[];
}

export function parseBundleInput(body: unknown): BundleInput | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  if (!name) return "Nama paket wajib diisi.";
  const rawItems = Array.isArray(b.items) ? b.items : [];
  const items = rawItems
    .map((i) => {
      const it = (i ?? {}) as Record<string, unknown>;
      return {
        referenceType: (it.referenceType === "PRODUCT" ? "PRODUCT" : "PROCEDURE") as ReferenceType,
        procedureId: Number(it.procedureId) || 0,
        procedureName: String(it.procedureName ?? "").trim(),
        quantity: Math.max(1, Math.floor(Number(it.quantity) || 1)),
      };
    })
    .filter((i) => i.procedureId > 0);
  if (items.length === 0) return "Paket butuh minimal satu tindakan atau produk.";
  const seen = new Set<string>();
  for (const i of items) {
    const key = `${i.referenceType}:${i.procedureId}`;
    if (seen.has(key)) return "Item yang sama tidak boleh dobel dalam satu paket.";
    seen.add(key);
  }
  return {
    name,
    description: String(b.description ?? "").trim() || undefined,
    active: b.active === undefined ? undefined : Boolean(b.active),
    items,
  };
}

export async function saveBundle(input: BundleInput, id?: string): Promise<string> {
  return await sql.begin(async (tx) => {
    let bundleId = id;
    if (bundleId) {
      const updated = await tx`
        UPDATE bundles SET
          name = ${input.name},
          description = ${input.description ?? null},
          active = ${input.active ?? true},
          updated_at = now()
        WHERE id = ${bundleId} RETURNING id`;
      if (updated.length === 0) throw new Error("bundle tidak ditemukan");
      await tx`DELETE FROM bundle_items WHERE bundle_id = ${bundleId}`;
    } else {
      const [row] = await tx`
        INSERT INTO bundles (name, description, active)
        VALUES (${input.name}, ${input.description ?? null}, ${input.active ?? true})
        RETURNING id`;
      bundleId = row.id as string;
    }
    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i];
      await tx`
        INSERT INTO bundle_items (
          bundle_id, sort_order, procedure_id, procedure_name, quantity, reference_type
        ) VALUES (
          ${bundleId}, ${i}, ${it.procedureId}, ${it.procedureName ?? ""}, ${it.quantity ?? 1},
          ${it.referenceType}
        )`;
    }
    return bundleId;
  });
}
