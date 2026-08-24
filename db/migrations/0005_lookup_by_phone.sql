-- patient_lookup gains No. HP as a third search key alongside NIK and No. RM.
-- Existing lookup blocks default to enabled, matching allow_mrn's behaviour.
ALTER TABLE form_blocks ADD COLUMN IF NOT EXISTS allow_phone boolean;

UPDATE form_blocks SET allow_phone = true WHERE kind = 'patient_lookup' AND allow_phone IS NULL;
