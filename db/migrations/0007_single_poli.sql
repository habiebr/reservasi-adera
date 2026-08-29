-- A form can be dedicated to one poli: the "Pilih Poli" step disappears and the poli is
-- filled in for the patient. Meant for embedding the wizard in that poli's own web page.
-- Which poli it is still lives in form_block_specializations (exactly one row, enforced by
-- validateDefinition); this flag only records that the step is not the patient's to answer.
ALTER TABLE form_blocks ADD COLUMN IF NOT EXISTS single_poli boolean;
