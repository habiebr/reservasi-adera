// Three-pane form builder: block palette · drag-to-arrange page canvas · config panel,
// plus a live mobile preview rendering the real wizard against the draft definition.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  GripVertical,
  Plus,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  BLOCK_LABELS,
  isCoreKind,
  isDateFirst,
  newBlock,
  validateDefinition,
  type BlockKind,
  type FormBlock,
  type FormBranding,
  type FormDefinition,
  type FormPage,
} from "@shared/formTypes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiGet, apiPost, apiPut } from "@/lib/api";
import { cn } from "@/lib/utils";
import WizardRenderer from "@/components/wizard/WizardRenderer";
import BlockConfigPanel from "./BlockConfigPanel";

interface FormDetail {
  id: string;
  slug: string;
  title: string;
  status: string;
  branding: FormBranding;
  definition: FormDefinition;
  problems: string[];
}

const uid = () => crypto.randomUUID();

export default function FormEditor() {
  const { id = "" } = useParams();
  const [form, setForm] = useState<FormDetail | null>(null);
  const [def, setDef] = useState<FormDefinition | null>(null);
  const [branding, setBranding] = useState<FormBranding>({});
  const [title, setTitle] = useState("");
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const saveTimer = useRef<number>();
  const dirty = useRef(false);

  useEffect(() => {
    apiGet<FormDetail>(`/api/admin/forms/${id}`).then((f) => {
      setForm(f);
      setDef(f.definition);
      setBranding(f.branding);
      setTitle(f.title);
      setServerProblems(f.problems);
    });
  }, [id]);

  const problems = useMemo(() => (def ? validateDefinition(def) : []), [def]);

  const scheduleSave = useCallback(
    (nextDef: FormDefinition, nextTitle: string, nextBranding: FormBranding) => {
      dirty.current = true;
      window.clearTimeout(saveTimer.current);
      setSaveState("saving");
      saveTimer.current = window.setTimeout(async () => {
        try {
          const r = await apiPut<{ problems: string[] }>(`/api/admin/forms/${id}`, {
            title: nextTitle,
            branding: nextBranding,
            definition: nextDef,
          });
          setServerProblems(r.problems ?? []);
          setSaveState("saved");
          dirty.current = false;
        } catch (e) {
          setSaveState("error");
          // A published form rejected for being invalid answers with the offending list —
          // show that, not just "gagal", so the admin can see what to put back.
          const detail = e instanceof ApiError && Array.isArray(e.body.problems)
            ? (e.body.problems as string[])
            : [];
          setServerProblems([
            e instanceof Error ? e.message : "Gagal menyimpan.",
            ...detail,
          ]);
        }
      }, 700);
    },
    [id],
  );

  const patchDef = useCallback(
    (updater: (d: FormDefinition) => FormDefinition) => {
      setDef((d) => {
        if (!d) return d;
        const next = updater(d);
        scheduleSave(next, title, branding);
        return next;
      });
    },
    [scheduleSave, title, branding],
  );

  // ── DnD ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const findPageOf = (d: FormDefinition, blockId: string) =>
    d.pages.find((p) => p.blocks.some((b) => b.id === blockId));

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over || !def) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId.startsWith("pg-")) return; // pages reorder on drag end only
    // move a block into another page while hovering
    const from = findPageOf(def, activeId);
    const to = overId.startsWith("pg-")
      ? def.pages.find((p) => `pg-${p.id}` === overId)
      : findPageOf(def, overId);
    if (!from || !to || from.id === to.id) return;
    patchDef((d) => {
      const block = from.blocks.find((b) => b.id === activeId)!;
      const overIdx = overId.startsWith("pg-")
        ? to.blocks.length
        : to.blocks.findIndex((b) => b.id === overId);
      return {
        ...d,
        pages: d.pages.map((p) => {
          if (p.id === from.id) {
            return { ...p, blocks: p.blocks.filter((b) => b.id !== activeId) };
          }
          if (p.id === to.id) {
            const blocks = [...p.blocks];
            blocks.splice(overIdx < 0 ? blocks.length : overIdx, 0, block);
            return { ...p, blocks };
          }
          return p;
        }),
      };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || !def || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId.startsWith("pg-") && overId.startsWith("pg-")) {
      patchDef((d) => {
        const oldIdx = d.pages.findIndex((p) => `pg-${p.id}` === activeId);
        const newIdx = d.pages.findIndex((p) => `pg-${p.id}` === overId);
        return { ...d, pages: arrayMove(d.pages, oldIdx, newIdx) };
      });
      return;
    }
    // block reorder within its (possibly new) page
    patchDef((d) => {
      const page = findPageOf(d, activeId);
      if (!page) return d;
      const oldIdx = page.blocks.findIndex((b) => b.id === activeId);
      const newIdx = page.blocks.findIndex((b) => b.id === overId);
      if (oldIdx < 0 || newIdx < 0) return d;
      return {
        ...d,
        pages: d.pages.map((p) =>
          p.id === page.id ? { ...p, blocks: arrayMove(p.blocks, oldIdx, newIdx) } : p
        ),
      };
    });
  };

  // ── palette ──
  const placedKinds = useMemo(
    () => new Set(def?.pages.flatMap((p) => p.blocks.map((b) => b.kind)) ?? []),
    [def],
  );
  const addBlock = (kind: BlockKind) => {
    patchDef((d) => {
      const block = newBlock(kind, uid());
      const pages = [...d.pages];
      if (pages.length === 0) {
        pages.push({ id: uid(), title: BLOCK_LABELS[kind], blocks: [block] });
      } else {
        const last = pages[pages.length - 1];
        pages[pages.length - 1] = { ...last, blocks: [...last.blocks, block] };
      }
      return { ...d, pages };
    });
  };

  const publish = async () => {
    try {
      await apiPost(`/api/admin/forms/${id}/publish`);
      setForm((f) => (f ? { ...f, status: "published" } : f));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal menerbitkan.");
    }
  };
  const unpublish = async () => {
    await apiPost(`/api/admin/forms/${id}/unpublish`);
    setForm((f) => (f ? { ...f, status: "draft" } : f));
  };

  if (!form || !def) return <div className="min-h-screen bg-background" />;

  const allProblems = [...new Set([...problems, ...serverProblems])];
  const selected = def.pages.flatMap((p) => p.blocks).find((b) => b.id === selectedBlock) ?? null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to="/admin"><ArrowLeft className="h-4 w-4" /> Kembali</Link>
          </Button>
          <div className="min-w-0 flex-1">
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (def) scheduleSave(def, e.target.value, branding);
              }}
              className="h-9 max-w-md border-transparent bg-transparent px-2 font-display text-base font-bold focus-visible:border-input"
            />
            <p className="px-2 text-xs text-muted-foreground">/{form.slug}</p>
          </div>
          <span className="text-xs text-muted-foreground">
            {saveState === "saving" ? "Menyimpan…" : saveState === "saved" ? "✓ Tersimpan" : saveState === "error" ? "⚠ Gagal simpan" : ""}
          </span>
          <Button variant="outline" size="sm" onClick={() => setShowPreview((v) => !v)} className="gap-1">
            <Smartphone className="h-4 w-4" /> {showPreview ? "Tutup Pratinjau" : "Pratinjau"}
          </Button>
          {form.status === "published"
            ? (
              <>
                <span className="chip chip-success">Terbit</span>
                <Button variant="outline" size="sm" onClick={unpublish}>Tarik</Button>
              </>
            )
            : (
              <Button size="sm" onClick={publish} disabled={allProblems.length > 0} className="gap-1">
                <Eye className="h-4 w-4" /> Terbitkan
              </Button>
            )}
        </div>
        {allProblems.length > 0 && (
          <div className="border-t border-warning/40 bg-warning-muted px-4 py-2">
            <div className="mx-auto max-w-[1400px]">
              {allProblems.map((p, i) => (
                <p key={i} className="flex items-center gap-1.5 text-xs text-warning-foreground">
                  <AlertTriangle className="h-3 w-3 shrink-0" /> {p}
                </p>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 py-4 lg:grid-cols-[220px_minmax(0,1fr)_320px]">
        {/* Palette */}
        <aside className="space-y-2 lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Blok
          </p>
          {(Object.keys(BLOCK_LABELS) as BlockKind[]).map((kind) => {
            const disabled = isCoreKind(kind) && placedKinds.has(kind);
            return (
              <button
                key={kind}
                disabled={disabled}
                onClick={() => addBlock(kind)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm transition-all",
                  disabled
                    ? "cursor-not-allowed opacity-40"
                    : "hover:border-primary/60 hover:text-primary",
                )}
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{BLOCK_LABELS[kind]}</span>
              </button>
            );
          })}
          <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
            Klik untuk menambah ke halaman terakhir, lalu seret untuk mengatur urutan — blok bisa
            dipindah antar halaman.
          </p>

          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Branding
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Judul hero</Label>
              <Input
                value={branding.headline ?? ""}
                onChange={(e) => {
                  const b = { ...branding, headline: e.target.value };
                  setBranding(b);
                  scheduleSave(def, title, b);
                }}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Deskripsi</Label>
              <Textarea
                rows={2}
                value={branding.description ?? ""}
                onChange={(e) => {
                  const b = { ...branding, description: e.target.value };
                  setBranding(b);
                  scheduleSave(def, title, b);
                }}
                className="text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Catatan kaki</Label>
              <Input
                value={branding.footerNote ?? ""}
                onChange={(e) => {
                  const b = { ...branding, footerNote: e.target.value };
                  setBranding(b);
                  scheduleSave(def, title, b);
                }}
                className="h-9 text-sm"
              />
            </div>
          </div>
        </aside>

        {/* Canvas */}
        <main className="space-y-3">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={def.pages.map((p) => `pg-${p.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {def.pages.map((page, pi) => (
                <PageCard
                  key={page.id}
                  page={page}
                  index={pi}
                  selectedBlock={selectedBlock}
                  onSelectBlock={setSelectedBlock}
                  onRename={(t) =>
                    patchDef((d) => ({
                      ...d,
                      pages: d.pages.map((p) => (p.id === page.id ? { ...p, title: t } : p)),
                    }))}
                  onDelete={page.blocks.every((b) => !isCoreKind(b.kind))
                    ? () =>
                      patchDef((d) => ({
                        ...d,
                        pages: d.pages.filter((p) => p.id !== page.id),
                      }))
                    : undefined}
                  onToggleBlock={(blockId, enabled) =>
                    patchDef((d) => ({
                      ...d,
                      pages: d.pages.map((p) => ({
                        ...p,
                        blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, enabled } : b)),
                      })),
                    }))}
                  onDeleteBlock={(blockId) =>
                    patchDef((d) => ({
                      ...d,
                      pages: d.pages.map((p) => ({
                        ...p,
                        blocks: p.blocks.filter((b) => b.id !== blockId),
                      })),
                    }))}
                />
              ))}
            </SortableContext>
          </DndContext>
          <Button
            variant="outline"
            onClick={() =>
              patchDef((d) => ({
                ...d,
                pages: [...d.pages, { id: uid(), title: "Halaman baru", blocks: [] }],
              }))}
            className="w-full gap-1 border-dashed"
          >
            <Plus className="h-4 w-4" /> Tambah halaman
          </Button>
        </main>

        {/* Config / Preview */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          {showPreview
            ? (
              <div className="rounded-[2rem] border-8 border-foreground/80 bg-background shadow-xl">
                <div className="max-h-[75vh] w-full overflow-y-auto rounded-[1.5rem] p-5">
                  <PreviewBoundary defKey={JSON.stringify(def)}>
                    <WizardRenderer
                      slug={form.slug}
                      definition={def}
                      branding={branding}
                      preview
                    />
                  </PreviewBoundary>
                </div>
              </div>
            )
            : selected
              ? (
                <BlockConfigPanel
                  block={selected}
                  dateFirst={isDateFirst(def)}
                  onChange={(patch) =>
                    patchDef((d) => ({
                      ...d,
                      pages: d.pages.map((p) => ({
                        ...p,
                        blocks: p.blocks.map((b) =>
                          b.id === selected.id ? { ...b, ...patch, config: { ...b.config, ...patch.config } } : b
                        ),
                      })),
                    }))}
                />
              )
              : (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Pilih sebuah blok untuk mengatur isinya, atau buka Pratinjau.
                </div>
              )}
        </aside>
      </div>
    </div>
  );
}

/** Remounts the preview whenever the definition changes so wizard state never goes stale. */
function PreviewBoundary({ defKey, children }: { defKey: string; children: React.ReactNode }) {
  return <div key={defKey}>{children}</div>;
}

function PageCard({
  page,
  index,
  selectedBlock,
  onSelectBlock,
  onRename,
  onDelete,
  onToggleBlock,
  onDeleteBlock,
}: {
  page: FormPage;
  index: number;
  selectedBlock: string | null;
  onSelectBlock: (id: string) => void;
  onRename: (title: string) => void;
  onDelete?: () => void;
  onToggleBlock: (blockId: string, enabled: boolean) => void;
  onDeleteBlock: (blockId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `pg-${page.id}`,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-xl border border-border bg-card shadow-sm",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          aria-label="Seret halaman"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="flex h-5 w-5 items-center justify-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
          {index + 1}
        </span>
        <input
          value={page.title}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Judul halaman"
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground"
        />
        {onDelete && (
          <button onClick={onDelete} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <SortableContext items={page.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5 p-2">
          {page.blocks.map((block) => (
            <BlockCard
              key={block.id}
              block={block}
              selected={selectedBlock === block.id}
              onSelect={() => onSelectBlock(block.id)}
              onToggle={(v) => onToggleBlock(block.id, v)}
              onDelete={!isCoreKind(block.kind) ? () => onDeleteBlock(block.id) : undefined}
            />
          ))}
          {page.blocks.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              Seret blok ke sini.
            </p>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function BlockCard({
  block,
  selected,
  onSelect,
  onToggle,
  onDelete,
}: {
  block: FormBlock;
  selected: boolean;
  onSelect: () => void;
  onToggle: (v: boolean) => void;
  onDelete?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-lg border-2 px-2.5 py-2 transition-colors",
        selected ? "border-primary bg-primary-muted" : "border-border bg-background",
        isDragging && "z-10 opacity-80 shadow-md",
        !block.enabled && "opacity-50",
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        aria-label="Seret blok"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-foreground">
          {block.title || BLOCK_LABELS[block.kind]}
        </span>
        <span className="block text-[11px] text-muted-foreground">{BLOCK_LABELS[block.kind]}</span>
      </button>
      <Switch checked={block.enabled} onCheckedChange={onToggle} className="scale-90" />
      {onDelete && (
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
