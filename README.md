# reservasi-adera

Form builder + reservasi kunjungan pasien Klinik Adera, terhubung langsung ke **Calq EMR**
(poli → dokter → jadwal → cek NIK/No. RM → data pasien → tindakan + Lunas/DP → bayar DOKU →
invoice + email). Admin menyusun beberapa form publik dengan **drag-and-drop blok per halaman**;
tiap form terbit di URL sendiri (`/{slug}`).

Aplikasi ini berdiri sendiri — terpisah dari repo vaksinadera. Satu server Deno (Hono) melayani
API JSON dan SPA hasil build, plus satu Postgres.

## Arsitektur singkat

```
web/      React + Vite + Tailwind + shadcn/ui  → dibuild ke web/dist
server/   Deno + Hono: /api/* + serve web/dist (SPA fallback)
shared/   Tipe definisi form + validasi + hitungan harga — dipakai server & web
db/       Migrasi SQL polos, dijalankan server/migrate.ts (tabel schema_migrations)
```

- **Definisi form disimpan relasional** (`forms → form_pages → form_blocks` + tabel allow-list
  poli/tindakan + `form_fields`), bukan blob JSON. Terbit = validasi urutan blok lolos.
- **Booking dipecah per tanggung jawab**: `bookings` (reservasi) · `booking_patients` (snapshot
  pasien) · `booking_items` (rincian tindakan) · `booking_payments` (siklus DOKU) ·
  `booking_emr` (state tulis-balik Calq) · `booking_answers` · `booking_failures`.
- **Jadwal & dokter dikelola di Calq** — aplikasi ini hanya membaca
  (`/medical-personnels/schedules?date=` adalah sumber slot yang benar; lihat docs/ARCHITECTURE.md).
- **Pembayaran**: checkout DOKU milik sendiri (HMAC), webhook `/api/webhooks/doku`. Setelah
  PAID: buat appointment Calq (dapat kode booking + nomor antrean) → buat sale → POST payment
  (`DOWN_PAYMENT`/`REGULAR`) → email invoice. Idempoten per langkah (kolom latch di `booking_emr`).

## Menjalankan (dev)

```bash
cp .env.example .env            # isi kredensial Calq + DOKU (sandbox)
docker compose up -d db
deno task migrate
deno task seed-admin admin@klinikadera.co.id <password> "Nama Admin"
deno task dev                   # API + SPA build lama di :8300
cd web && npm install && npm run dev   # dev SPA di :5183 (proxy /api → :8300)
```

Tes: `deno task test` (shared) · `cd web && npm run build` (typecheck + build).

## Produksi

```bash
docker compose up -d --build    # db + app + cloudflared (migrasi jalan otomatis saat boot)
```

**Cloudflare Tunnel** ikut di compose (service `cloudflared`), meng-expose
`https://reservasi-adera.habiebraharjo.xyz → http://app:8300`. Ingress ada di
`cloudflared/config.yml` (tanpa rahasia, boleh di-commit); identitas + kredensial tunnel
datang dari `TUNNEL_TOKEN` di `.env`. Menyiapkan ulang di mesin baru:

```bash
cloudflared tunnel login                 # pilih zone habiebraharjo.xyz
cloudflared tunnel create reservasi-adera
cloudflared tunnel route dns reservasi-adera reservasi-adera.habiebraharjo.xyz
cloudflared tunnel token reservasi-adera # salin hasilnya ke TUNNEL_TOKEN di .env
```

Deploy yang sudah punya token cukup mengisi `TUNNEL_TOKEN` — tak perlu `login`/`create` lagi.

`APP_URL` di `.env` harus sama dengan hostname tunnel — dipakai untuk link invoice dan
`notification_url` DOKU. Webhook DOKU dikirim per-order — tidak perlu mengubah dashboard DOKU.

## Halaman

| URL | Untuk | Isi |
|---|---|---|
| `/{slug}` | Publik | Wizard reservasi hasil builder |
| `/{slug}/status?invoice=` | Publik | Status bayar → kode booking, antrean, invoice |
| `/admin` | Admin | Form (builder DnD), Reservasi, Dokter & Jadwal (read-only Calq), Gagal Bayar, Pengaturan |
| `/admin/forms/:id` | Admin | Editor tiga panel: palet blok · kanvas halaman · konfigurasi + pratinjau HP |

Detail teknis + temuan API Calq: **docs/ARCHITECTURE.md**.
