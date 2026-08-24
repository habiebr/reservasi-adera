-- Reverses 0005: No. HP is no longer a patient_lookup search key, so the per-block toggle
-- has nothing left to configure. The masked phone on the confirmation card is unaffected —
-- it is shown for identity confirmation, not used to search.
ALTER TABLE form_blocks DROP COLUMN IF EXISTS allow_phone;
