-- One form answers the bare domain. Splitting "pick a service" from "pick a poli" made the
-- patient choose twice for the same thing, so "/" now renders a form outright rather than a
-- menu leading to one. At most one form may claim it; the partial unique index makes that a
-- database fact rather than a convention.
ALTER TABLE forms ADD COLUMN IF NOT EXISTS is_home boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS forms_one_home ON forms (is_home) WHERE is_home;
