-- reservasi-adera — initial schema.
-- Design rule: fully relational, one responsibility per table.
-- The form definition lives in rows (forms → form_pages → form_blocks → allow-lists/fields);
-- there is no jsonb definition blob. Booking state is split into three independent state
-- machines: bookings.status (reservation), booking_payments.status (money),
-- booking_emr.sync_status (EMR write-back).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────── Form definition ─────────────────────────

CREATE TABLE forms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  headline    text,
  description text,
  footer_note text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE form_pages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id    uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  sort_order int  NOT NULL,
  title      text NOT NULL DEFAULT '',
  UNIQUE (form_id, sort_order) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE form_blocks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id      uuid NOT NULL REFERENCES form_pages(id) ON DELETE CASCADE,
  sort_order   int  NOT NULL,
  kind         text NOT NULL CHECK (kind IN (
                 'info_page','poli_picker','doctor_picker','schedule_picker',
                 'patient_lookup','patient_data','pricing_payment','summary_consent')),
  enabled      boolean NOT NULL DEFAULT true,
  title        text,
  description  text,
  -- typed per-kind config (nullable; only the columns a kind uses are set)
  max_days_ahead int,                                            -- schedule_picker
  time_display   text CHECK (time_display IN ('segmented','dropdown')), -- schedule_picker
  allow_mrn      boolean,                                        -- patient_lookup
  ask_address    boolean,                                        -- patient_data
  pricing_mode   text CHECK (pricing_mode IN ('procedure','package')), -- pricing_payment
  dp_enabled     boolean,                                        -- pricing_payment
  dp_rule        text CHECK (dp_rule IN ('calq','fixed','percent')),   -- pricing_payment
  dp_value       int,                                            -- pricing_payment
  consent_text   text,                                           -- summary_consent
  info_body      text,                                           -- info_page
  UNIQUE (page_id, sort_order) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE form_block_specializations (
  block_id            uuid NOT NULL REFERENCES form_blocks(id) ON DELETE CASCADE,
  specialization_id   int  NOT NULL,
  specialization_name text NOT NULL DEFAULT '',
  PRIMARY KEY (block_id, specialization_id)
);

CREATE TABLE form_block_procedures (
  block_id       uuid NOT NULL REFERENCES form_blocks(id) ON DELETE CASCADE,
  procedure_id   int  NOT NULL,
  procedure_name text NOT NULL DEFAULT '',
  PRIMARY KEY (block_id, procedure_id)
);

CREATE TABLE form_fields (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id   uuid NOT NULL REFERENCES form_blocks(id) ON DELETE CASCADE,
  sort_order int  NOT NULL,
  label      text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text','textarea','choice')),
  options    text[],
  required   boolean NOT NULL DEFAULT false,
  UNIQUE (block_id, sort_order) DEFERRABLE INITIALLY DEFERRED
);

-- ───────────────────────── Bookings ─────────────────────────

CREATE TABLE bookings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id             uuid REFERENCES forms(id),
  calq_patient_id     text,
  is_new_patient      boolean NOT NULL DEFAULT false,
  polyclinic_id       int,
  polyclinic_name     text,
  specialization_id   int  NOT NULL,
  specialization_name text,
  medical_personnel_id int,
  doctor_name         text,
  calq_schedule_id    int  NOT NULL,   -- Calq doctor-schedule id (POST /appointments scheduleId)
  visit_date          date NOT NULL,
  slot_time           text,            -- "HH:MM"; NULL = QUEUE-type visit (no slot concept)
  booking_order_type  text,            -- QUEUE | EXACT_TIME (from Calq)
  status              text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','CONFIRMED','CANCELLED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One live booking per timed slot. Calq marks a slot per booking (status available/booked,
-- capacity 1 — verified against the sandbox), so a unique hold is the correct model.
CREATE UNIQUE INDEX bookings_slot_hold
  ON bookings (calq_schedule_id, visit_date, slot_time)
  WHERE status IN ('PENDING','CONFIRMED') AND slot_time IS NOT NULL;
CREATE INDEX bookings_sched_day ON bookings (calq_schedule_id, visit_date, status);
CREATE INDEX bookings_status    ON bookings (status, created_at DESC);

CREATE TABLE booking_patients (
  booking_id      uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  nik             text,
  mrn             text,
  nama_lengkap    text NOT NULL,
  tanggal_lahir   date,
  jenis_kelamin   text,
  nomor_hp        text,
  email           text,
  alamat_domisili text
);
CREATE INDEX booking_patients_nik ON booking_patients (nik);

CREATE TABLE booking_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  procedure_id   int  NOT NULL,
  procedure_name text NOT NULL,
  unit_price     int  NOT NULL,
  quantity       int  NOT NULL DEFAULT 1
);
CREATE INDEX booking_items_booking ON booking_items (booking_id);

CREATE TABLE booking_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  invoice_number   text NOT NULL UNIQUE,   -- RSV-YYYYMMDDHHMMSS-NNNN
  jenis_pembayaran text NOT NULL CHECK (jenis_pembayaran IN ('LUNAS','DP')),
  total_amount     int  NOT NULL,
  dp_amount        int,
  amount_due       int  NOT NULL,          -- what DOKU charges now
  payment_url      text,
  status           text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','PAID','EXPIRED')),
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_payments_booking ON booking_payments (booking_id);

CREATE TABLE booking_emr (
  booking_id          uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  appointment_id      text,
  booking_code        text,   -- Calq "BKG-…"
  queue_number        text,
  sale_id             text,
  sale_invoice_number text,
  payment_posted_at   timestamptz,
  sync_status         text NOT NULL DEFAULT 'PENDING'
                      CHECK (sync_status IN ('PENDING','REGISTERED','FAILED')),
  error               text,
  error_at            timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- field_label is snapshotted so the answer stays readable even if the admin later deletes
-- or relabels the custom field (field_id then goes NULL, the record survives).
CREATE TABLE booking_answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  field_id    uuid REFERENCES form_fields(id) ON DELETE SET NULL,
  field_label text NOT NULL,
  value       text NOT NULL DEFAULT ''
);
CREATE INDEX booking_answers_booking ON booking_answers (booking_id);

-- DOKU-refused attempts. Outlives the deleted booking on purpose → no FK.
CREATE TABLE booking_failures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number   text,
  form_slug        text,
  payload          jsonb,   -- raw sanitized request (capture, not a model)
  stage            text NOT NULL DEFAULT 'doku_create',
  http_status      int,
  error_code       text,
  error_message    text,
  gateway_response jsonb,
  resolved         boolean NOT NULL DEFAULT false,
  resolved_by      text,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── App ─────────────────────────

CREATE TABLE admin_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text NOT NULL DEFAULT '',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  to_email   text NOT NULL,
  status     text NOT NULL,   -- SENT | FAILED | SKIPPED
  error      text,
  sent_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_log_booking ON email_log (booking_id);
