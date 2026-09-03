# Automatic API Partner Approval

Alur baru Admin Libra:

1. Partner mengisi `/partner/api-onboarding`.
2. Admin membuka `/admin-partner-links` lalu `Review & Approve`.
3. Pada `/admin-api-onboarding`, tombol `Approve & Buat UAT` otomatis membuat:
   - Partner ID unik
   - temporary PIN portal 6 digit
   - API Key
   - API Secret
   - Webhook Signing Secret
   - record lifecycle UAT
4. Secret/PIN penuh hanya ditampilkan pada response approval tersebut. Setelah refresh, gunakan rotasi/reset bila secret hilang.
5. API hanya menerima partner yang sudah memiliki lifecycle UAT.
6. Selama UAT, partner wajib mengirim `x-libra-environment: UAT`.
7. Production tetap terkunci sampai checklist UAT Final PASS dan saldo deposit memenuhi minimum opening deposit.
8. Setelah itu Admin Libra mengaktifkan Production dari `/admin-api-uat`.

## Prinsip keamanan

- Approval tidak langsung membuka Production.
- Tidak ada deposit yang diwajibkan sebelum UAT PASS.
- Partner yang dibuat tetapi gagal dihubungkan ke lifecycle UAT otomatis dikunci `PENDING`.
- Kredensial sensitif tidak pernah ditampilkan pada daftar partner biasa.
- API partner tanpa record UAT ditolak oleh backend.
