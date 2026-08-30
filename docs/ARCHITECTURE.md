# Arsitektur & Temuan API Calq

> Verifikasi terakhir: 2026-08-23, terhadap sandbox Calq `simrs-adera-dev-local.techave.dev`.
> OpenAPI lengkap: `GET {base}/api/docs-json` (Swagger UI di `/api/docs`).

## Temuan API Calq yang menjadi dasar desain (semua diverifikasi live)

1. **Calq punya sistem appointment rawat jalan penuh** yang tidak dipakai vaksinadera:
   `/polyclinic`, `/specializations`, `/medical-personnels(/schedules)`, `/appointments`,
   `/procedure`, `/payment-methods`, dst.
2. **`bookingOrderType`**: `QUEUE` (159 spesialisasi — pasien dapat nomor antrean) vs
   `EXACT_TIME` (2 saja di sandbox: Gigi #61, Vaksin #163 — slot per `sessionDuration` menit,
   30 mnt untuk Gigi, 15 mnt untuk Vaksin). Keduanya dilayani endpoint yang sama; yang
   membedakan hanya isi jawabannya:

   | | QUEUE | EXACT_TIME |
   |---|---|---|
   | `timeSlots[]` bertanggal | **selalu kosong** | terisi, teriris `sessionDuration` |
   | Yang dipilih pasien | sesi praktik (`scheduleId`) | satu jam (`scheduleId` + `startTime`) |
   | Batas kapasitas | **tak ada di API** — tak ada field kuota di mana pun | jumlah slot itu sendiri |
   | Arti "penuh" | tidak ada; hanya "praktik / tidak" | semua slot `status: "booked"` |
   | Nomor antrean | `queue.bookedNumber` terbit saat `POST /appointments` | — |

   Wizard mengikuti pembagian ini, bukan mengikut konfigurasi form: setelah tanggal dipilih,
   poli antrean menampilkan **dokter yang praktik hari itu** lalu sesinya, sedangkan poli jam
   langsung menampilkan **grid jam gabungan seluruh dokter** — dokternya ikut dari slot yang
   diklik dan tidak diperlihatkan (`doctorImplicit`), sehingga blok Pilih Dokter tak lagi
   ditampilkan. Lihat `picksHourNotDoctor` di web/src/components/wizard/types.ts.

   `schedules[]` tak punya field kuota sama sekali (hanya id, medicalPersonnelId, dayOfWeek,
   startTime, endTime, timeZone, roomId, branchId) — jadi untuk poli antrean, "ketersediaan"
   memang cuma bisa berarti *dokternya praktik dan sesinya belum tutup*.
   `status` slot diverifikasi 60 hari: hanya `"available"` dan `"booked"` (yang booked
   membawa `bookingCode`).
   ⚠️ Satu dokter bisa punya **jadwal bertumpuk di hari yang sama** (dokter Vaksin sandbox:
   08:00–20:00 *dan* 00:00–23:59), dan jam yang bertumpuk dipancarkan sekali per jadwal —
   144 slot untuk 96 jam. Lihat `dedupeSlotsByTime` di shared/availability.ts.
   ⚠️ Calq melaporkan **jadwal, bukan jam dinding**: pukul 16.00 pun slot 00:00 hari itu
   masih dijawab `"available"`. Penyaringan jam lewat ada di pihak kita (`isPast`).
3. **Sumber slot yang benar = `GET /medical-personnels/schedules?specializationId=&date=`** —
   mengembalikan dokter + `schedules[]` (dayOfWeek/jam) + `timeSlots[]` per slot dengan
   `status: "available"` / terisi (+ `bookingCode`) dan `scheduleId` per slot.
   ⚠️ `GET /appointments/available-time-slots` TIDAK dapat diandalkan: untuk dokter
   EXACT_TIME pun ia menjawab `bookingOrderType: "QUEUE"` dengan `timeSlots: []`.
   ⚠️ `?date=` mengubah bentuk jawaban: **`schedules[]` menyempit ke hari dari tanggal itu
   saja**, dan `timeSlots[]` baru terisi. Tanpa `date=`, `schedules[]` memuat sepekan penuh
   tapi `timeSlots[]` kosong. Karena itu hari praktik mingguan (chip di kartu dokter,
   kalender) diambil dari panggilan tanpa tanggal yang di-cache, sedangkan ketersediaan
   selalu dari panggilan bertanggal yang tidak pernah di-cache lama.
4. **`POST /appointments`** (bentuk asli, dari error validasi zod — DTO di swagger adalah DTO
   BPJS, abaikan): `{type:'OFFLINE'|'ONLINE', date, scheduleId (id jadwal dokter),
   specializationId, patientId (harus sudah ada — FK procedure_result), procedureId
   (number|array), hasAcceptedPrivacyPolicy, roomId?}` → balasannya membawa
   `bookingCode "BKG-…"` dan `queue.bookedNumber` (nomor antrean langsung terbit).
5. **Appointment yang dibuat via API TIDAK otomatis membuat sale/invoice pra-kunjungan.**
   Sale yang terlihat menempel di appointment lama dibuat saat konsultasi/checkout oleh alur
   klinik. Maka aplikasi ini **membuat sale sendiri** (`POST /sales`) setelah pembayaran.
6. ⚠️ **`GET /appointments?date=` juga DIABAIKAN** — tanggal apa pun mengembalikan 10 baris
   yang sama persis. Sekelas dengan bug `?search`/`?patientId` di bawah: jangan pernah
   percaya filter query Calq tanpa membuktikannya dulu. (Bentuk barisnya sendiri berguna:
   membawa `bookingCode`, `paymentStatus`, dan `queue: {bookedNumber, status}` dengan status
   `BOOKED` / `CHECKED_IN`.)
7. **`GET /sales?patientId=` DIABAIKAN Calq** (mengembalikan semua pasien). Pencarian yang
   bekerja: `GET /sales?search=<MRN atau no. invoice>` — sama seperti praktik vaksinadera.
8. **`POST /sales` butuh `roomId` untuk item PROCEDURE** ("Ruangan dibutuhkan…"). Appointment
   buatan API biasanya belum punya room → fallback `CALQ_DEFAULT_ROOM_ID` /
   `app_settings.calq_default_room_id` (sandbox: `4` = ruangan "02").
9. **`POST /patients`** langsung memberi `id` + `medicalRecordNumber` (mis. `SBA002418`) —
   pasien baru bisa langsung dipakai untuk appointment.
10. `POST /sales/{id}/payments {methodId, amount, type: 'DOWN_PAYMENT'|'REGULAR', note}` —
   DP didukung native. Metode: sandbox Doku id `14`, produksi `3` (`CALQ_PAYMENT_METHOD_ID_*`).
11. Aturan warisan vaksinadera yang tetap dipegang: **item sebelum pembayaran** (membayar
    invoice kosong membuat Calq menandai invoice Rp0 PAID), dan **sale berstatus PAID tidak
    boleh di-PATCH/dibayar lagi** (isFullyPaid guard).
12. `dayOfWeek` Calq = `Date.getDay()` JS (Minggu = 0).

## Urutan tulis-balik setelah DOKU PAID (`server/emrSync.ts`)

Setiap langkah latch ke kolom `booking_emr` — retry (webhook ulang / tombol admin) melanjutkan
dari titik gagal, tidak pernah menggandakan:

2. Pastikan payment PAID + booking CONFIRMED. `sync_status='REGISTERED'` → selesai.
3. Pasien: `calq_patient_id` harus ada (dibuat saat wizard; retry di sini bila kosong).
4. **Appointment** (latch `appointment_id`): `POST /appointments` → simpan
   `booking_code`, `queue_number`. Gagal → `sync_status='FAILED'` + pesan Calq utuh
   (uang aman di DOKU; pemulihan: ubah jadwal di Calq lalu "Ulangi EMR").
   Appointment tidak pernah dihapus (punya procedure_result).
5. **Sale** (latch `sale_id`): probe idempoten `GET /sales?search={MRN}` (item PROCEDURE sama,
   belum PAID) → kalau tidak ada, `POST /sales` (roomId lihat temuan #7,
   notes = no. invoice RSV + kode booking).
6. **Payment** (latch `payment_posted_at`): re-GET sale → guard isFullyPaid + item-tidak-kosong
   → `POST /sales/{id}/payments` `type` sesuai LUNAS/DP.
7. `REGISTERED`; email invoice best-effort (`email_log` = latch kirim).

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
