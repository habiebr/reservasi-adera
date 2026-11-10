-- Promo vouchers (Flash Sale 11.11 Vaxigrip TIV): pay online via DOKU → voucher code →
-- admin redeems at the clinic, and only then does anything reach Calq
-- (patient → sale with the promo product → payment). Kept apart from bookings: no slot,
-- no appointment, one person (NIK) per order.

CREATE TABLE IF NOT EXISTS promo_campaigns (
  id              text PRIMARY KEY,               -- also the public path: /11-11
  title           text NOT NULL,
  product_label   text NOT NULL,                  -- shown to the patient
  calq_product_id integer,                        -- PRODUCT line on redeem; NULL blocks redeem
  price_normal    integer NOT NULL,               -- crossed out
  price_promo     integer NOT NULL,               -- what DOKU charges and Calq bills
  sale_starts     timestamptz NOT NULL,
  sale_ends       timestamptz NOT NULL,
  redeem_until    timestamptz NOT NULL,
  visit_period    text NOT NULL,                  -- "11–18 November 2026, jam praktik"
  active          boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     text NOT NULL REFERENCES promo_campaigns(id),
  token           text NOT NULL UNIQUE,           -- voucher link /v/<token>
  invoice_number  text NOT NULL UNIQUE,           -- VCR-… (DOKU)
  nama            text NOT NULL,
  nik             text NOT NULL,
  dob             date NOT NULL,
  sex             text NOT NULL CHECK (sex IN ('MALE','FEMALE')),
  phone           text NOT NULL,
  email           text,
  amount          integer NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','EXPIRED')),
  payment_url     text,
  paid_at         timestamptz,
  voucher_code    text UNIQUE,                    -- 8 digits, set when PAID
  wa_sent_at      timestamptz,
  wa_error        text,
  email_sent_at   timestamptz,
  email_error     text,
  -- redeem (latched step by step, so a retry resumes and never duplicates)
  redeemed_at     timestamptz,
  redeemed_by     text,
  calq_patient_id text,
  calq_mrn        text,
  calq_sale_id    text,
  calq_invoice_no text,
  calq_paid_at    timestamptz,
  redeem_error    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promo_orders_campaign_status ON promo_orders (campaign_id, status);
CREATE INDEX IF NOT EXISTS promo_orders_nik ON promo_orders (nik);

INSERT INTO promo_campaigns
  (id, title, product_label, calq_product_id, price_normal, price_promo,
   sale_starts, sale_ends, redeem_until, visit_period)
VALUES
  ('11-11', 'Flash Sale 11.11', 'Vaksin Influenza Vaxigrip TIV', NULL, 310000, 189000,
   '2026-11-11 00:00:00+07', '2026-11-12 00:00:00+07', '2026-11-18 23:59:59+07',
   '11–18 November 2026, jam praktik')
ON CONFLICT (id) DO NOTHING;
