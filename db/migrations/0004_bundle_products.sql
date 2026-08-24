-- Paket boleh memuat obat/produk (Calq sale item referenceType PRODUCT), bukan hanya
-- tindakan. Appointment tetap hanya membawa procedureId, jadi setiap reservasi wajib punya
-- minimal satu item PROCEDURE (divalidasi di server).

ALTER TABLE bundle_items
  ADD COLUMN reference_type text NOT NULL DEFAULT 'PROCEDURE'
    CHECK (reference_type IN ('PROCEDURE','PRODUCT'));

ALTER TABLE booking_items
  ADD COLUMN reference_type text NOT NULL DEFAULT 'PROCEDURE'
    CHECK (reference_type IN ('PROCEDURE','PRODUCT'));

-- procedure_id kini menyimpan id tindakan ATAU id produk sesuai reference_type
COMMENT ON COLUMN booking_items.procedure_id IS
  'Calq reference id: procedure id bila reference_type=PROCEDURE, product id bila PRODUCT';
