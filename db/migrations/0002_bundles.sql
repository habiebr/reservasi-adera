-- Paket (bundle) manager: admin-curated packages that combine Calq procedures under a
-- custom display name. Prices are never stored — the server recomputes them from live Calq
-- per underlying procedure, so DOKU, the Calq sale, and EMR sync always agree.

CREATE TABLE bundles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bundle_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id      uuid NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  sort_order     int  NOT NULL DEFAULT 0,
  procedure_id   int  NOT NULL,
  procedure_name text NOT NULL,  -- snapshot so the admin list renders when Calq is down
  quantity       int  NOT NULL DEFAULT 1 CHECK (quantity > 0)
);
CREATE INDEX bundle_items_bundle ON bundle_items (bundle_id);

-- Which bundles a pricing_payment block offers (empty = all active bundles).
CREATE TABLE form_block_bundles (
  block_id    uuid NOT NULL REFERENCES form_blocks(id) ON DELETE CASCADE,
  bundle_id   uuid NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  bundle_name text NOT NULL DEFAULT '',
  PRIMARY KEY (block_id, bundle_id)
);

-- Booking lines stay per-procedure (the Calq sale needs them) but remember the bundle they
-- came from, so summaries/invoices can show one line per package.
ALTER TABLE booking_items
  ADD COLUMN bundle_id uuid,
  ADD COLUMN bundle_name text;
