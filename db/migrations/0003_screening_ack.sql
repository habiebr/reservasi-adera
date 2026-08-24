-- Flow-maker modules: blok Skrining (Ya/Tidak questions with an optional blocking answer)
-- and info_page's "wajib centang sudah membaca" gate.

ALTER TABLE form_blocks DROP CONSTRAINT form_blocks_kind_check;
ALTER TABLE form_blocks ADD CONSTRAINT form_blocks_kind_check CHECK (kind IN (
  'info_page','poli_picker','doctor_picker','schedule_picker',
  'patient_lookup','patient_data','pricing_payment','summary_consent','screening'));

-- info_page: patient must tick "saya telah membaca" before continuing
ALTER TABLE form_blocks ADD COLUMN require_ack boolean;

-- screening questions live in form_fields (field_type 'screening'); answers land in
-- booking_answers like any custom field. block_answer = the answer that stops the flow.
ALTER TABLE form_fields DROP CONSTRAINT form_fields_field_type_check;
ALTER TABLE form_fields ADD CONSTRAINT form_fields_field_type_check CHECK (
  field_type IN ('text','textarea','choice','screening'));
ALTER TABLE form_fields
  ADD COLUMN block_answer text,
  ADD COLUMN block_message text;
