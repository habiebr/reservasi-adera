# Arsitektur & Temuan API Calq

> Verifikasi terakhir: 2026-08-23, terhadap sandbox Calq `simrs-adera-dev-local.techave.dev`.
> OpenAPI lengkap: `GET {base}/api/docs-json` (Swagger UI di `/api/docs`).

## Temuan API Calq yang menjadi dasar desain (semua diverifikasi live)

1. **Calq punya sistem appointment rawat jalan penuh** yang tidak dipakai vaksinadera:
   `/polyclinic`, `/specializations`, `/medical-personnels(/schedules)`, `/appointments`,
   `/procedure`, `/payment-methods`, dst.
2. **`bookingOrderType`**: `QUEUE` (161 spesialisasi — pasien dapat nomor antrean) vs
   `EXACT_TIME` (mis. Gigi, Vaksinasi — slot per `sessionDuration` menit).
3. **Sumber slot yang benar = `GET /medical-personnels/schedules?specializationId=&date=`** —
   mengembalikan dokter + `schedules[]` (dayOfWeek/jam) + `timeSlots[]` per slot dengan
   `status: "available"` / terisi (+ `bookingCode`) dan `scheduleId` per slot.
   ⚠️ `GET /appointments/available-time-slots` TIDAK dapat diandalkan: untuk dokter
   EXACT_TIME pun ia menjawab `bookingOrderType: "QUEUE"` dengan `timeSlots: []`.
4. **`POST /appointments`** (bentuk asli, dari error validasi zod — DTO di swagger adalah DTO
   BPJS, abaikan): `{type:'OFFLINE'|'ONLINE', date, scheduleId (id jadwal dokter),
   specializationId, patientId (harus sudah ada — FK procedure_result), procedureId
   (number|array), hasAcceptedPrivacyPolicy, roomId?}` → balasannya membawa
   `bookingCode "BKG-…"` dan `queue.bookedNumber` (nomor antrean langsung terbit).
5. **Appointment yang dibuat via API TIDAK otomatis membuat sale/invoice pra-kunjungan.**
   Sale yang terlihat menempel di appointment lama dibuat saat konsultasi/checkout oleh alur
   klinik. Maka aplikasi ini **membuat sale sendiri** (`POST /sales`) setelah pembayaran.
6. **`GET /sales?patientId=` DIABAIKAN Calq** (mengembalikan semua pasien). Pencarian yang
   bekerja: `GET /sales?search=<MRN atau no. invoice>` — sama seperti praktik vaksinadera.
7. **`POST /sales` butuh `roomId` untuk item PROCEDURE** ("Ruangan dibutuhkan…"). Appointment
   buatan API biasanya belum punya room → fallback `CALQ_DEFAULT_ROOM_ID` /
   `app_settings.calq_default_room_id` (sandbox: `4` = ruangan "02").
8. **`POST /patients`** langsung memberi `id` + `medicalRecordNumber` (mis. `SBA002418`) —
   pasien baru bisa langsung dipakai untuk appointment.
9. `POST /sales/{id}/payments {methodId, amount, type: 'DOWN_PAYMENT'|'REGULAR', note}` —
   DP didukung native. Metode: sandbox Doku id `14`, produksi `3` (`CALQ_PAYMENT_METHOD_ID_*`).
10. Aturan warisan vaksinadera yang tetap dipegang: **item sebelum pembayaran** (membayar
    invoice kosong membuat Calq menandai invoice Rp0 PAID), dan **sale berstatus PAID tidak
    boleh di-PATCH/dibayar lagi** (isFullyPaid guard).
11. `dayOfWeek` Calq = `Date.getDay()` JS (Minggu = 0).

## Urutan tulis-balik setelah DOKU PAID (`server/emrSync.ts`)

Setiap langkah latch ke kolom `booking_emr` — retry (webhook ulang / tombol admin) melanjutkan
dari titik gagal, tidak pernah menggandakan:

1. Pastikan payment PAID + booking CONFIRMED. `sync_status='REGISTERED'` → selesai.
2. Pasien: `calq_patient_id` harus ada (dibuat saat wizard; retry di sini bila kosong).
3. **Appointment** (latch `appointment_id`): `POST /appointments` → simpan
   `booking_code`, `queue_number`. Gagal → `sync_status='FAILED'` + pesan Calq utuh
   (uang aman di DOKU; pemulihan: ubah jadwal di Calq lalu "Ulangi EMR").
   Appointment tidak pernah dihapus (punya procedure_result).
4. **Sale** (latch `sale_id`): probe idempoten `GET /sales?search={MRN}` (item PROCEDURE sama,
   belum PAID) → kalau tidak ada, `POST /sales` (roomId lihat temuan #7,
   notes = no. invoice RSV + kode booking).
5. **Payment** (latch `payment_posted_at`): re-GET sale → guard isFullyPaid + item-tidak-kosong
   → `POST /sales/{id}/payments` `type` sesuai LUNAS/DP.
6. `REGISTERED`; email invoice best-effort (`email_log` = latch kirim).

## Slot hold & kedaluwarsa

- Index unik parsial `bookings (calq_schedule_id, visit_date, slot_time)` untuk status
  PENDING/CONFIRMED — kapasitas Calq memang 1 pasien per slot (diverifikasi: slot terisi
  berstatus non-available + membawa bookingCode).
- `/api/calq/slots` = slot Calq **dikurangi** hold lokal yang masih hidup.
- DOKU `payment_due_date: 60` menit; webhook EXPIRED (atau poll status inline di halaman
  status) membatalkan booking → index hold lepas. Tidak perlu cron.

## Keamanan

- `POST /api/booking/lookup` adalah permukaan enumerasi NIK → respons **disamarkan**
  (`Te* Re******* Ad***`, `**-**-1995`) + throttle per-IP in-memory.
- Kredensial (Calq, DOKU, SMTP, JWT) hanya di `.env` — `app_settings` cuma untuk toggle
  non-rahasia (`calq_env`, `doku_env`, `calq_default_room_id`).
- Admin: `admin_users` (bcrypt) + JWT HS256 di cookie HttpOnly; seluruh `/api/admin/*`
  (kecuali login) di belakang middleware.

## Verifikasi yang sudah dijalankan (sandbox, 2026-08-23)

- Pasien uji dibuat via API: Calq id `78352`, MRN `SBA002418` (NIK `9999…0001`).
- Booking end-to-end: create → DOKU checkout URL terbit → (PAID disimulasikan) → sync:
  appointment `21168` / `BKG-244850` / antrean `1`, sale `18605` / `2608000007`,
  payment REGULAR Rp30.000 → status sale **PAID** di Calq; retry kedua = "sudah tersinkron"
  (tanpa duplikat).
- Slot hold: booking kedua pada jam sama → 409; `/api/calq/slots` menandai jam itu tidak
  tersedia; setelah EXPIRED/CANCELLED slot kembali.

## Risiko / catatan operasional

- Tabrakan dengan booking yang dibuat kasir langsung di Calq antara checkout dan webhook →
  appointment gagal → FAILED + alert; pemulihan manual (ubah jadwal) + Ulangi EMR.
- Konfirmasi `notification_url` per-order dihormati akun DOKU produksi saat go-live.
- Saat pasien datang, kasir melihat sale bernotes "Reservasi online RSV-… — BKG-…" dengan
  pembayaran DP/lunas sudah menempel — jangan membuat invoice kedua untuk tindakan yang sama.
