# API Partner UAT + OpenAI — PT Libra Jaya Logistic

## Alur

1. Partner mengirim pengajuan dari `/partner/api-onboarding`.
2. Admin membuat Partner ID/API credential di `/admin-partners`.
3. Admin membuka `/admin-partner-links` → `UAT & Go-Live API`, lalu menghubungkan pengajuan ke Partner ID.
4. Setelah terhubung, Production API partner tersebut terkunci sampai UAT dan deposit selesai.
5. Selama UAT partner menambahkan header `x-libra-environment: UAT` pada setiap request.
6. Booking UAT adalah dry-run (`UAT_VALIDATED`) dan **tidak mendebit wallet**.
7. Dashboard menilai HMAC/authentication, quote, booking UAT, idempotency, tracking, webhook dan error handling dari log.
8. Admin dapat menekan `Analisa dengan OpenAI` untuk memperoleh second opinion teknis.
9. Final `PASS` tetap keputusan Admin Libra dan hanya dapat diberikan bila baseline teknis sudah PASS.
10. Setelah PASS, partner diminta top-up sesuai minimum opening deposit yang ditetapkan admin.
11. Tombol `Aktifkan Production API` baru terbuka bila saldo >= minimum deposit. Setelah diaktifkan, request `PRODUCTION` diizinkan.

## Header UAT

Selain header HMAC v1 yang sudah ada, gunakan:

`x-libra-environment: UAT`

Untuk booking tetap wajib:

`x-libra-idempotency-key: <unique-key>`

Retry dengan idempotency key yang sama harus menghasilkan Booking ID yang sama. Respons pertama UAT normalnya HTTP 201 dan retry HTTP 200.

## OpenAI

Tambahkan di Netlify Environment Variables:

- `OPENAI_API_KEY` — secret server-side, jangan ditaruh di repo atau frontend.
- `OPENAI_UAT_MODEL` — opsional. Default aplikasi: `gpt-5.6-terra`.

Backend menggunakan OpenAI Responses API dengan Structured Outputs (`json_schema`). Data yang dikirim untuk analisa dibatasi pada metadata teknis UAT, checklist dan log API yang sudah disanitasi; API Key/Secret partner tidak dikirim.

OpenAI hanya memberi rekomendasi. Keputusan final PASS/Conditional/FAIL serta aktivasi Production tetap tindakan admin yang terautentikasi.

## Deposit gate

Minimum opening deposit ditetapkan per partner di panel UAT. Deposit tidak menjadi syarat untuk menjalankan dry-run UAT. Production hanya dapat diaktifkan bila:

- baseline teknis = PASS;
- keputusan final admin = PASS;
- minimum opening deposit > 0; dan
- saldo wallet partner >= minimum opening deposit.

## Catatan webhook

Saat ini status webhook pada checklist UAT dicatat/diapprove admin berdasarkan pengujian callback dengan partner. Jangan menandai PASS sebelum callback partner benar-benar terbukti menerima event sesuai kontrak integrasi.
