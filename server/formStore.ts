// Assemble the relational form definition into the wire FormDefinition, and decompose a
// saved definition back into rows. Ids are preserved across saves (booking_answers and the
// builder's DnD state key on them); rows the payload no longer contains are deleted.
import { sql } from "./db.ts";
import type {
  BlockConfig,
  CustomField,
  FormBlock,
  FormDefinition,
  FormPage,
  ScreeningQuestion,
} from "@shared/formTypes.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keepId = (id: string | undefined) => (id && UUID_RE.test(id) ? id : crypto.randomUUID());

export interface FormRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  headline: string | null;
  description: string | null;
  footer_note: string | null;
  created_at: string;
  updated_at: string;
}

export async function assembleDefinition(formId: string): Promise<FormDefinition> {
  const pages = await sql`
    SELECT id, title FROM form_pages WHERE form_id = ${formId} ORDER BY sort_order`;
  if (pages.length === 0) return { schemaVersion: 1, pages: [] };
  const pageIds = pages.map((p) => p.id as string);

  const blocks = await sql`
    SELECT * FROM form_blocks WHERE page_id IN ${sql(pageIds)} ORDER BY sort_order`;
  const blockIds = blocks.map((b) => b.id as string);

  const [specs, procs, fields, bundleRefs] = blockIds.length === 0
    ? [[], [], [], []]
    : await Promise.all([
      sql`SELECT * FROM form_block_specializations WHERE block_id IN ${sql(blockIds)}`,
      sql`SELECT * FROM form_block_procedures WHERE block_id IN ${sql(blockIds)}`,
      sql`SELECT * FROM form_fields WHERE block_id IN ${sql(blockIds)} ORDER BY sort_order`,
      sql`SELECT * FROM form_block_bundles WHERE block_id IN ${sql(blockIds)}`,
    ]);

  const wirePages: FormPage[] = pages.map((p) => ({
    id: p.id as string,
    title: (p.title as string) ?? "",
    blocks: blocks
      .filter((b) => b.page_id === p.id)
      .map((b): FormBlock => {
        const config: BlockConfig = {};
        if (b.max_days_ahead != null) config.maxDaysAhead = Number(b.max_days_ahead);
        if (b.time_display != null) config.timeDisplay = b.time_display as "segmented" | "dropdown";
        if (b.allow_mrn != null) config.allowMrn = Boolean(b.allow_mrn);
        if (b.ask_address != null) config.askAddress = Boolean(b.ask_address);
        if (b.pricing_mode != null) config.pricingMode = b.pricing_mode as "procedure" | "package";
        if (b.dp_enabled != null) config.dpEnabled = Boolean(b.dp_enabled);
        if (b.dp_rule != null) config.dpRule = b.dp_rule as "calq" | "fixed" | "percent";
        if (b.dp_value != null) config.dpValue = Number(b.dp_value);
        if (b.consent_text != null) config.consentText = b.consent_text as string;
        if (b.info_body != null) config.infoBody = b.info_body as string;
        if (b.require_ack != null) config.requireAck = Boolean(b.require_ack);
        if (b.single_poli != null) config.singlePoli = Boolean(b.single_poli);
        if (b.kind === "poli_picker") {
          config.allowedSpecializations = specs
            .filter((s) => s.block_id === b.id)
            .map((s) => ({ id: Number(s.specialization_id), name: s.specialization_name as string }));
        }
        if (b.kind === "pricing_payment") {
          config.allowedProcedures = procs
            .filter((s) => s.block_id === b.id)
            .map((s) => ({ id: Number(s.procedure_id), name: s.procedure_name as string }));
          config.allowedBundles = bundleRefs
            .filter((s) => s.block_id === b.id)
            .map((s) => ({ id: s.bundle_id as string, name: (s.bundle_name as string) ?? "" }));
        }
        if (b.kind === "patient_data") {
          config.customFields = fields
            .filter((f) => f.block_id === b.id)
            .map((f): CustomField => ({
              id: f.id as string,
              label: f.label as string,
              fieldType: f.field_type as CustomField["fieldType"],
              options: (f.options as string[] | null) ?? [],
              required: Boolean(f.required),
            }));
        }
        if (b.kind === "screening") {
          config.screeningQuestions = fields
            .filter((f) => f.block_id === b.id)
            .map((f): ScreeningQuestion => ({
              id: f.id as string,
              text: f.label as string,
              blockAnswer: (f.block_answer as ScreeningQuestion["blockAnswer"]) ?? "",
              blockMessage: (f.block_message as string | null) ?? undefined,
            }));
        }
        return {
          id: b.id as string,
          kind: b.kind as FormBlock["kind"],
          enabled: Boolean(b.enabled),
          title: (b.title as string | null) ?? undefined,
          description: (b.description as string | null) ?? undefined,
          config,
        };
      }),
  }));

  return { schemaVersion: 1, pages: wirePages };
}

export async function saveDefinition(formId: string, def: FormDefinition): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SET CONSTRAINTS ALL DEFERRED`;

    const pageIds = def.pages.map((p) => keepId(p.id));
    // deleting a page cascades to its blocks/allow-lists; fields cascade off blocks and
    // booking_answers.field_id is ON DELETE SET NULL, so history is never in the way.
    if (pageIds.length > 0) {
      await tx`DELETE FROM form_pages WHERE form_id = ${formId} AND id NOT IN ${tx(pageIds)}`;
    } else {
      await tx`DELETE FROM form_pages WHERE form_id = ${formId}`;
    }

    const allBlockIds: string[] = [];
    const allFieldIds: string[] = [];

    for (let pi = 0; pi < def.pages.length; pi++) {
      const page = def.pages[pi];
      const pageId = pageIds[pi];
      await tx`
        INSERT INTO form_pages (id, form_id, sort_order, title)
        VALUES (${pageId}, ${formId}, ${pi}, ${page.title ?? ""})
        ON CONFLICT (id) DO UPDATE SET sort_order = ${pi}, title = ${page.title ?? ""}`;

      for (let bi = 0; bi < page.blocks.length; bi++) {
        const block = page.blocks[bi];
        const blockId = keepId(block.id);
        allBlockIds.push(blockId);
        const c = block.config ?? {};
        const cols = {
          page_id: pageId,
          sort_order: bi,
          kind: block.kind,
          enabled: block.enabled,
          title: block.title ?? null,
          description: block.description ?? null,
          max_days_ahead: c.maxDaysAhead ?? null,
          time_display: c.timeDisplay ?? null,
          allow_mrn: c.allowMrn ?? null,
          ask_address: c.askAddress ?? null,
          pricing_mode: c.pricingMode ?? null,
          dp_enabled: c.dpEnabled ?? null,
          dp_rule: c.dpRule ?? null,
          dp_value: c.dpValue ?? null,
          consent_text: c.consentText ?? null,
          info_body: c.infoBody ?? null,
          require_ack: c.requireAck ?? null,
          single_poli: c.singlePoli ?? null,
        };
        await tx`
          INSERT INTO form_blocks ${tx({ id: blockId, ...cols })}
          ON CONFLICT (id) DO UPDATE SET ${tx(cols)}`;

        await tx`DELETE FROM form_block_specializations WHERE block_id = ${blockId}`;
        for (const s of c.allowedSpecializations ?? []) {
          await tx`
            INSERT INTO form_block_specializations (block_id, specialization_id, specialization_name)
            VALUES (${blockId}, ${s.id}, ${s.name ?? ""})
            ON CONFLICT DO NOTHING`;
        }
        await tx`DELETE FROM form_block_procedures WHERE block_id = ${blockId}`;
        for (const p of c.allowedProcedures ?? []) {
          await tx`
            INSERT INTO form_block_procedures (block_id, procedure_id, procedure_name)
            VALUES (${blockId}, ${p.id}, ${p.name ?? ""})
            ON CONFLICT DO NOTHING`;
        }
        await tx`DELETE FROM form_block_bundles WHERE block_id = ${blockId}`;
        for (const bref of c.allowedBundles ?? []) {
          if (!UUID_RE.test(bref.id)) continue;
          // INSERT…SELECT so a bundle deleted since the builder loaded is silently dropped
          await tx`
            INSERT INTO form_block_bundles (block_id, bundle_id, bundle_name)
            SELECT ${blockId}, b.id, ${bref.name ?? ""} FROM bundles b WHERE b.id = ${bref.id}
            ON CONFLICT DO NOTHING`;
        }

        // patient_data custom fields and screening questions share the form_fields table
        const fieldsWanted = block.kind === "patient_data"
          ? (c.customFields ?? []).map((f) => ({
            id: f.id,
            label: f.label ?? "",
            field_type: f.fieldType as string,
            options: f.options ?? [],
            required: Boolean(f.required),
            block_answer: null as string | null,
            block_message: null as string | null,
          }))
          : block.kind === "screening"
          ? (c.screeningQuestions ?? []).map((q) => ({
            id: q.id,
            label: q.text ?? "",
            field_type: "screening",
            options: [] as string[],
            required: true,
            block_answer: q.blockAnswer || null,
            block_message: q.blockMessage?.trim() || null,
          }))
          : [];
        for (let fi = 0; fi < fieldsWanted.length; fi++) {
          const f = fieldsWanted[fi];
          const fieldId = keepId(f.id);
          allFieldIds.push(fieldId);
          const fcols = {
            block_id: blockId,
            sort_order: fi,
            label: f.label,
            field_type: f.field_type,
            options: f.options,
            required: f.required,
            block_answer: f.block_answer,
            block_message: f.block_message,
          };
          await tx`
            INSERT INTO form_fields ${tx({ id: fieldId, ...fcols })}
            ON CONFLICT (id) DO UPDATE SET ${tx(fcols)}`;
        }
      }
    }

    if (allBlockIds.length > 0 && pageIds.length > 0) {
      await tx`
        DELETE FROM form_blocks
        WHERE page_id IN ${tx(pageIds)} AND id NOT IN ${tx(allBlockIds)}`;
      if (allFieldIds.length > 0) {
        await tx`
          DELETE FROM form_fields
          WHERE block_id IN ${tx(allBlockIds)} AND id NOT IN ${tx(allFieldIds)}`;
      } else {
        await tx`DELETE FROM form_fields WHERE block_id IN ${tx(allBlockIds)}`;
      }
    }

    await tx`UPDATE forms SET updated_at = now() WHERE id = ${formId}`;
  });
}

/** The pricing/DP + lookup/schedule config a booking request must be verified against. */
export interface BookingConfig {
  allowedSpecializationIds: number[];
  allowedProcedureIds: number[];
  pricingMode: "procedure" | "package";
  allowedBundleIds: string[];
  dpEnabled: boolean;
  dpRule: "calq" | "fixed" | "percent";
  dpValue?: number;
  maxDaysAhead: number;
  allowMrn: boolean;
  customFields: { id: string; label: string; required: boolean }[];
  screeningRules: { id: string; label: string; blockAnswer: string; blockMessage?: string }[];
}

export async function bookingConfigForForm(formId: string): Promise<BookingConfig> {
  const def = await assembleDefinition(formId);
  const flat = def.pages.flatMap((p) => p.blocks);
  const poli = flat.find((b) => b.kind === "poli_picker");
  const pricing = flat.find((b) => b.kind === "pricing_payment");
  const schedule = flat.find((b) => b.kind === "schedule_picker");
  const lookup = flat.find((b) => b.kind === "patient_lookup");
  const data = flat.find((b) => b.kind === "patient_data");
  const screenings = flat.filter((b) => b.kind === "screening" && b.enabled);
  const screeningQuestions = screenings.flatMap((s) => s.config.screeningQuestions ?? []);
  return {
    allowedSpecializationIds: (poli?.config.allowedSpecializations ?? []).map((s) => s.id),
    allowedProcedureIds: (pricing?.config.allowedProcedures ?? []).map((p) => p.id),
    pricingMode: pricing?.config.pricingMode ?? "procedure",
    allowedBundleIds: (pricing?.config.allowedBundles ?? []).map((b) => b.id),
    dpEnabled: pricing?.config.dpEnabled ?? false,
    dpRule: pricing?.config.dpRule ?? "calq",
    dpValue: pricing?.config.dpValue,
    maxDaysAhead: schedule?.config.maxDaysAhead ?? 30,
    allowMrn: lookup?.config.allowMrn ?? true,
    customFields: [
      ...(data?.config.customFields ?? []).map((f) => ({
        id: f.id,
        label: f.label,
        required: f.required,
      })),
      // screening answers are stored (and required) like custom fields
      ...screeningQuestions.map((q) => ({ id: q.id, label: q.text, required: true })),
    ],
    screeningRules: screeningQuestions
      .filter((q) => q.blockAnswer)
      .map((q) => ({
        id: q.id,
        label: q.text,
        blockAnswer: q.blockAnswer as string,
        blockMessage: q.blockMessage,
      })),
  };
}
