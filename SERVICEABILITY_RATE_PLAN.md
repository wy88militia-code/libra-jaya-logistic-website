# Serviceability API & Partner Rate Plan — Libra Jaya Logistic

## Tujuan
Sebelum partner meminta quote, sistem dapat menjawab apakah kelurahan tujuan dilayani, status operasionalnya, SLA, minimum load, cut-off, dan apakah harga dapat dihitung otomatis.

## Endpoint
`GET /api/v1/serviceability`

Contoh query:
`/api/v1/serviceability?administrative_code=9471011001&weight_kg=10`

Parameter pencarian yang didukung:
- `administrative_code` / `kode_wilayah`
- `route_code` / `kode_rute`
- `kelurahan` + opsional `distrik`
- `weight_kg` opsional untuk estimasi

Endpoint memakai autentikasi HMAC yang sama dengan API v1 lain. Karena signature memakai `PATH_WITH_QUERY`, query string harus ditandatangani persis sesuai request.

## Hasil Serviceability
Response mengembalikan:
- `availability`: `AVAILABLE`, `CONDITIONAL`, `UNAVAILABLE`
- `quote_mode`: `AUTO`, `MANUAL_APPROVAL`, `BLOCKED`
- coverage status dan alasan
- route code / kode wilayah / hub / moda / zona tarif
- SLA dan titik mulai SLA
- minimum load operasional
- minimum chargeable weight dari Rate Plan
- cut-off WIT
- apakah rate tersedia
- estimasi harga bila `weight_kg` diberikan dan route dapat dihitung otomatis
- versi Master Rute yang digunakan

## Coverage → Quote Mode
- `ACTIVE` + rate cocok → `AUTO`
- `ACTIVE` tanpa rate → `MANUAL_APPROVAL`
- `MINIMUM_LOAD`, `ON_REQUEST`, `CHARTER_REQUIRED`, `MANUAL_REVIEW` → `MANUAL_APPROVAL`
- `OUT_OF_COVERAGE`, `NOT_ACTIVE`, `PENDING_VERIFICATION` → `BLOCKED`

## Rate Plan per Partner
Rate Plan disimpan terpisah dari Master Rute. Master menentukan **apakah rute operasional**, sedangkan Rate Plan menentukan **harga jual partner**.

Prioritas rule:
1. `ROUTE:<kode_rute>`
2. `ZONE:<zona_tarif>`
3. `DEFAULT`

Komponen harga:
- rate per kg
- minimum chargeable kg
- fixed fee
- handling fee
- surcharge persen
- cut-off WIT

Rumus:
`chargeable_kg = max(actual_weight_kg, minimum_chargeable_kg)`

`base = chargeable_kg × rate_per_kg`

`total = base + surcharge + fixed_fee + handling_fee`

### Minimum charge vs minimum load
Keduanya berbeda:
- **Minimum chargeable kg** adalah dasar penagihan. Contoh kiriman 3 kg dengan minimum charge 10 kg ditagih 10 kg.
- **Minimum load kg** adalah syarat operasional konsolidasi/rute. Jika belum tercapai, quote masuk approval/manual sesuai kebijakan route.

## Cut-off
Default backend: `14:00 WIT`, dapat dioverride per Rate Plan rule. Default juga dapat diubah melalui environment variable `LIBRA_CUTOFF_WIT` dengan format `HH:MM`.

## Legacy rate table
`LIBRA_RATE_TABLE_JSON` tetap menjadi fallback hanya untuk partner yang **belum memiliki Rate Plan**. Begitu Rate Plan dibuat:
- rule partner menjadi sumber harga utama;
- jika Rate Plan `INACTIVE`, automatic pricing dimatikan;
- jika Rate Plan `ACTIVE` tetapi tidak ada rule yang cocok, quote masuk manual approval dan tidak jatuh kembali ke legacy table.

## Admin Libra
Menu: `/admin-rate-plans`

Admin dapat:
- memilih Partner ID,
- membuat Default/Route/Zone rule,
- mengatur minimum charge,
- surcharge/fixed/handling,
- cut-off,
- mengaktifkan/nonaktifkan Rate Plan,
- menghapus rule.

Harga di Rate Plan adalah **harga jual ke partner**, bukan cost internal Libra.
