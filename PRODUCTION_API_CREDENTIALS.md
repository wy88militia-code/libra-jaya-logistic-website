# Production API Credentials — Libra Jaya Logistic

## Prinsip
Kredensial UAT dan Production dipisahkan. API Secret UAT tidak boleh dipakai untuk transaksi live.

### UAT
- API Key: credential yang diterbitkan saat onboarding/aktivasi awal.
- Header wajib: `x-libra-environment: UAT`.
- Booking UAT adalah dry-run dan tidak mendebit saldo.

### Production
- Baru tersedia setelah:
  1. seluruh UAT wajib PASS,
  2. Final PASS diberikan Admin Libra,
  3. minimum opening deposit terpenuhi,
  4. Admin Libra mengaktifkan Production API.
- Partner membuka Dashboard API dan menekan **Ambil Kredensial Production**.
- Backend menerbitkan `lbr_live_...` + Production API Secret.
- Production API Secret ditampilkan satu kali pada response claim.
- Header `x-libra-environment: PRODUCTION` boleh dipakai eksplisit; jika header environment dihilangkan, backend menganggap request sebagai Production.

## Isolation
- UAT API Key + Secret hanya valid untuk environment UAT.
- Production API Key + Secret hanya valid untuk environment Production.
- Jika key dan environment tidak cocok, backend mengembalikan `API_KEY_ENVIRONMENT_MISMATCH`.
- Production request sebelum Production diaktifkan mengembalikan `API_PRODUCTION_LOCKED`.
- Production request sebelum credential live di-claim mengembalikan `API_PRODUCTION_CREDENTIALS_NOT_CLAIMED`.

## One-time claim
Endpoint partner:
`POST /.netlify/functions/partner-production-credentials`

Syarat:
- sesi portal partner valid,
- partner berasal dari onboarding API,
- Production sudah diaktifkan,
- Final PASS masih valid,
- saldo memenuhi minimum opening deposit.

Response sukses memuat Production API Key dan Production API Secret. Response menggunakan `Cache-Control: no-store`. Secret tidak dapat ditampilkan ulang setelah claim berhasil.

## Penyimpanan
Partner wajib menyimpan API Secret di server-side secret manager atau environment variable. Jangan menyimpan API Secret di browser, source code publik, spreadsheet, atau chat.

## Rotasi
Jika Production API Secret hilang atau dicurigai bocor:
1. Admin Libra membuka **API Partner & Audit**.
2. Tekan **Rotate Production** pada Partner ID terkait.
3. API Key/Secret Production lama langsung tidak berlaku.
4. Status partner berubah kembali menjadi `READY_TO_CLAIM`.
5. Partner login ke Dashboard API dan menekan **Ambil Kredensial Production** untuk mengambil credential baru satu kali.

Secret baru tidak pernah ditampilkan di halaman admin.
