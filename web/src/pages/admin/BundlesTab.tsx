// Paket manager: combine Calq tindakan under a custom display name (a one-item paket doubles
// as an alternative name for a procedure). Prices always come from live Calq — shown here,
// recomputed server-side at booking time.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Package, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { formatRupiah } from "@shared/pricing";
import { cn } from "@/lib/utils";

type ReferenceType = "PROCEDURE" | "PRODUCT";

interface BundleItemRow {
  referenceType: ReferenceType;
  procedureId: number;
  procedureName: string;
  quantity: number;
  unitPrice?: number;
  missing?: boolean;
}

interface BundleRow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  price?: number;
  available?: boolean;
  items: BundleItemRow[];
}

/** Unified catalog entry: a Calq tindakan or an obat/produk. */
interface CatalogItem {
  referenceType: ReferenceType;
  id: number;
  name: string;
  price: number;
  hint?: string | null;
}

interface Draft {
  id?: string;
  name: string;
  description: string;
  active: boolean;
  items: {
    referenceType: ReferenceType;
    procedureId: number;
    procedureName: string;
    quantity: number;
  }[];
}

const itemKey = (t: ReferenceType, id: number) => `${t}:${id}`;

const emptyDraft = (): Draft => ({ name: "", description: "", active: true, items: [] });

export default function BundlesTab() {
  const [bundles, setBundles] = useState<BundleRow[] | null>(null);
  const [priced, setPriced] = useState(true);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    apiGet<{ priced: boolean; bundles: BundleRow[] }>("/api/admin/bundles")
      .then((r) => {
        setBundles(r.bundles);
        setPriced(r.priced);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat paket."));
  }, []);
  useEffect(refresh, [refresh]);

  // one searchable catalog over both tindakan and obat/produk
  useEffect(() => {
    Promise.all([
      apiGet<{ procedures: { id: number; name: string; price: number }[] }>(
        "/api/admin/calq/procedures",
      ).catch(() => ({ procedures: [] })),
      apiGet<{ products: { id: number; name: string; price: number; genericName: string | null }[] }>(
        "/api/admin/calq/products",
      ).catch(() => ({ products: [] })),
    ]).then(([p, pr]) => {
      setCatalog([
        ...p.procedures
          .filter((x) => x.price > 0)
          .map((x): CatalogItem => ({
            referenceType: "PROCEDURE",
            id: x.id,
            name: x.name,
            price: x.price,
          })),
        ...pr.products
          .filter((x) => x.price > 0)
          .map((x): CatalogItem => ({
            referenceType: "PRODUCT",
            id: x.id,
            name: x.name,
            price: x.price,
            hint: x.genericName,
          })),
      ]);
    });
  }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: draft.name,
        description: draft.description,
        active: draft.active,
        items: draft.items,
      };
      if (draft.id) await apiPut(`/api/admin/bundles/${draft.id}`, payload);
      else await apiPost("/api/admin/bundles", payload);
      setDraft(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan paket.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (b: BundleRow) => {
    if (!confirm(`Hapus paket "${b.name}"? Form yang memakainya tidak akan menawarkannya lagi.`)) {
      return;
    }
    await apiDelete(`/api/admin/bundles/${b.id}`);
    if (draft?.id === b.id) setDraft(null);
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Paket Tindakan</h2>
          <p className="text-sm text-muted-foreground">
            Gabungkan tindakan dan obat/produk Calq dengan nama sendiri. Harga selalu mengikuti
            Calq.
          </p>
        </div>
        <Button onClick={() => setDraft(emptyDraft())} className="gap-1">
          <Plus className="h-4 w-4" /> Buat paket
        </Button>
      </div>

      {!priced && (
        <p className="flex items-center gap-1.5 rounded-lg bg-warning-muted p-2 text-xs text-warning-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Calq tidak terjangkau — harga tidak bisa dihitung sekarang, daftar tetap bisa dikelola.
        </p>
      )}
      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {draft && (
        <BundleEditor
          draft={draft}
          setDraft={setDraft}
          catalog={catalog}
          saving={saving}
          onSave={save}
          onCancel={() => setDraft(null)}
        />
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {(bundles ?? []).map((b) => (
          <div
            key={b.id}
            className={cn(
              "rounded-xl border border-border bg-card p-4",
              !b.active && "opacity-60",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                  <Package className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {b.name}
                    {!b.active && (
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                        nonaktif
                      </span>
                    )}
                  </p>
                  {b.description && (
                    <p className="text-xs text-muted-foreground">{b.description}</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() =>
                    setDraft({
                      id: b.id,
                      name: b.name,
                      description: b.description ?? "",
                      active: b.active,
                      items: b.items.map((i) => ({
                        referenceType: i.referenceType ?? "PROCEDURE",
                        procedureId: i.procedureId,
                        procedureName: i.procedureName,
                        quantity: i.quantity,
                      })),
                    })}
                  className="rounded p-1.5 text-muted-foreground hover:text-primary"
                  aria-label="Ubah paket"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => remove(b)}
                  className="rounded p-1.5 text-muted-foreground hover:text-destructive"
                  aria-label="Hapus paket"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-1 border-t border-border pt-2">
              {b.items.map((i) => (
                <div
                  key={itemKey(i.referenceType ?? "PROCEDURE", i.procedureId)}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className={cn("text-muted-foreground", i.missing && "text-destructive")}>
                    {i.quantity > 1 ? `${i.quantity}× ` : ""}
                    {i.procedureName}
                    {i.referenceType === "PRODUCT" && (
                      <span className="ml-1 text-[10px] uppercase text-muted-foreground">obat</span>
                    )}
                    {i.missing ? " — tidak aktif di Calq" : ""}
                  </span>
                  {i.unitPrice !== undefined && !i.missing && (
                    <span className="tabular-nums text-muted-foreground">
                      {formatRupiah(i.unitPrice * i.quantity)}
                    </span>
                  )}
                </div>
              ))}
              {b.price !== undefined && (
                <div className="flex items-center justify-between pt-1 text-sm font-semibold">
                  <span className="text-foreground">Total</span>
                  <span className="tabular-nums text-primary">{formatRupiah(b.price)}</span>
                </div>
              )}
              {b.available === false && (
                <p className="text-[11px] text-destructive">
                  Paket ini tidak muncul ke pasien sampai semua tindakannya aktif di Calq.
                </p>
              )}
            </div>
          </div>
        ))}
        {bundles && bundles.length === 0 && !draft && (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground lg:col-span-2">
            Belum ada paket. Buat paket pertama untuk dipakai di form dengan mode "Paket kustom".
          </p>
        )}
        {!bundles && !error && (
          <p className="p-4 text-sm text-muted-foreground">Memuat…</p>
        )}
      </div>
    </div>
  );
}

function BundleEditor({
  draft,
  setDraft,
  catalog,
  saving,
  onSave,
  onCancel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  catalog: CatalogItem[] | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState("");
  const chosen = useMemo(
    () => new Set(draft.items.map((i) => itemKey(i.referenceType, i.procedureId))),
    [draft.items],
  );
  const results = useMemo(
    () =>
      filter.trim().length < 2 ? [] : (catalog ?? [])
        .filter((p) => !chosen.has(itemKey(p.referenceType, p.id)))
        .filter((p) =>
          `${p.name} ${p.hint ?? ""}`.toLowerCase().includes(filter.toLowerCase())
        )
        .slice(0, 8),
    [catalog, filter, chosen],
  );

  const findLive = (i: Draft["items"][number]) =>
    catalog?.find((x) => x.referenceType === i.referenceType && x.id === i.procedureId);

  const total = useMemo(() => {
    if (!catalog) return null;
    let sum = 0;
    for (const i of draft.items) {
      const p = catalog.find((x) => x.referenceType === i.referenceType && x.id === i.procedureId);
      if (!p) return null;
      sum += p.price * i.quantity;
    }
    return sum;
  }, [catalog, draft.items]);

  const hasProcedure = draft.items.some((i) => i.referenceType === "PROCEDURE");
  const canSave = draft.name.trim().length > 0 && draft.items.length > 0 && hasProcedure;

  return (
    <div className="space-y-4 rounded-xl border-2 border-primary/40 bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-foreground">
          {draft.id ? "Ubah paket" : "Paket baru"}
        </h3>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Nama paket (yang dilihat pasien)</Label>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Contoh: Paket Perawatan Gigi Lengkap"
            className="h-10 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Deskripsi (opsional)</Label>
          <Textarea
            rows={1}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="min-h-10 text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Isi paket</Label>
        {draft.items.map((i) => {
          const live = findLive(i);
          return (
            <div
              key={itemKey(i.referenceType, i.procedureId)}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
            >
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                  i.referenceType === "PRODUCT"
                    ? "bg-secondary text-muted-foreground"
                    : "bg-primary-muted text-primary",
                )}
              >
                {i.referenceType === "PRODUCT" ? "Obat" : "Tindakan"}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {i.procedureName}
              </span>
              {live && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatRupiah(live.price)}
                </span>
              )}
              <Input
                type="number"
                min={1}
                max={99}
                value={i.quantity}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    items: draft.items.map((x) =>
                      itemKey(x.referenceType, x.procedureId) ===
                          itemKey(i.referenceType, i.procedureId)
                        ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) }
                        : x
                    ),
                  })}
                className="h-8 w-16 text-center text-sm"
                aria-label="Jumlah"
              />
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    items: draft.items.filter((x) =>
                      itemKey(x.referenceType, x.procedureId) !==
                        itemKey(i.referenceType, i.procedureId)
                    ),
                  })}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}

        <div className="relative">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={catalog
              ? "Cari tindakan atau obat/produk untuk ditambahkan…"
              : "Memuat katalog dari Calq…"}
            disabled={!catalog}
            className="h-10 text-sm"
          />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg">
              {results.map((p) => (
                <button
                  key={itemKey(p.referenceType, p.id)}
                  onClick={() => {
                    setDraft({
                      ...draft,
                      items: [
                        ...draft.items,
                        {
                          referenceType: p.referenceType,
                          procedureId: p.id,
                          procedureName: p.name,
                          quantity: 1,
                        },
                      ],
                    });
                    setFilter("");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                >
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                      p.referenceType === "PRODUCT"
                        ? "bg-secondary text-muted-foreground"
                        : "bg-primary-muted text-primary",
                    )}
                  >
                    {p.referenceType === "PRODUCT" ? "Obat" : "Tindakan"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {p.name}
                    {p.hint && (
                      <span className="ml-1 text-xs text-muted-foreground">({p.hint})</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatRupiah(p.price)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={draft.active}
              onCheckedChange={(v) => setDraft({ ...draft, active: v === true })}
            />
            Aktif (bisa dipakai form)
          </label>
          {total !== null && draft.items.length > 0 && (
            <span className="text-sm font-semibold text-primary">
              Total {formatRupiah(total)}
            </span>
          )}
          {draft.items.length > 0 && !hasProcedure && (
            <span className="text-xs text-destructive">
              Paket wajib memuat minimal satu tindakan.
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>Batal</Button>
          <Button onClick={onSave} disabled={!canSave || saving}>
            {saving ? "Menyimpan…" : "Simpan paket"}
          </Button>
        </div>
      </div>
    </div>
  );
}
