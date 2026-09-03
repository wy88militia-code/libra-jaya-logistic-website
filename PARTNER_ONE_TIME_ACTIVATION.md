# Secure One-Time Partner Activation

Alur handoff kredensial API Partner Libra:

1. Partner mengirim pengajuan onboarding API.
2. Admin Libra menekan `Approve & Buat UAT`.
3. Backend membuat Partner ID, API Key, API Secret, lifecycle UAT, dan Webhook Signing Secret.
4. Backend membuat activation token acak 256-bit yang berlaku 72 jam. Hanya hash token yang disimpan.
5. Admin menerima link `/partner/activate#id=...&token=...` dan mengirim link tersebut ke PIC yang sudah diverifikasi.
6. Token berada di URL fragment (`#`) sehingga tidak dikirim sebagai request URL ke server.
7. Partner membuka link, membuat PIN portal 6 digit sendiri, lalu mengambil API Key/API Secret/Webhook Secret satu kali.
8. Setelah claim berhasil, activation record berubah ke `CLAIMED`; link tidak dapat digunakan ulang.
9. API request ditolak dengan `API_ACTIVATION_REQUIRED` sampai aktivasi selesai.
10. Jika link bocor/hilang/kedaluwarsa, Admin menekan `Buat Link Aktivasi Baru`; link lama otomatis direvoke.

## Security

- Activation token tidak disimpan plaintext di backend; hanya SHA-256 hash.
- Claim memakai conditional write untuk mengurangi risiko double claim.
- Halaman activation menggunakan `no-store` dan `no-referrer`.
- API Secret dan Webhook Secret tetap tersimpan server-side karena dibutuhkan untuk HMAC, tetapi hanya ditampilkan ke partner pada claim pertama.
- PIN portal tidak pernah disimpan plaintext; partner memilih PIN sendiri dan backend menyimpan scrypt hash + salt.
- Production tetap terkunci sampai UAT Final PASS dan minimum opening deposit terpenuhi.
