-- The queue number was only ever written once, at POST /appointments, and Calq's
-- queue.status (BOOKED → CHECKED_IN) was thrown away entirely. Cek Antrean re-reads both
-- from GET /appointments/{id}, so give the status somewhere to live next to the number.
ALTER TABLE booking_emr ADD COLUMN IF NOT EXISTS queue_status text;
