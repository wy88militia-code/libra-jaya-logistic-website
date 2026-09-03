# Notification & Webhook Control Center

## Tujuan
Modul ini memberi Partner dan Admin Libra satu tempat untuk memantau notifikasi operasional serta delivery webhook Production/UAT.

## Notifikasi otomatis
Saat ini sistem membuat notifikasi internal untuk:
- booking Production/manual berhasil dibuat;
- saldo deposit turun melewati batas rendah;
- shipment DELIVERED/POD tersedia;
- shipment HELD, DAMAGED, atau CLAIM_PROCESS;
- webhook tracking gagal masuk antrean;
- webhook Production gagal pada percobaan pertama dan masuk retry;
- webhook Production berstatus DEAD setelah seluruh retry habis.

Notifikasi disimpan di Netlify Blobs `libra-notifications` dan dibedakan antara audience Partner dan Admin.

## Low balance
Default batas peringatan adalah Rp1.000.000. Dapat dioverride melalui environment variable:

`PARTNER_LOW_BALANCE_THRESHOLD`

Notifikasi dikirim saat saldo melewati batas dari atas ke bawah, sehingga tidak dikirim pada setiap transaksi ketika saldo sudah rendah.

## Partner Control Center
Route:

`/partner/webhook-control`

Partner hanya dapat melihat notifikasi dan webhook delivery miliknya sendiri. Partner dapat:
- menandai notifikasi dibaca;
- menandai semua notifikasi dibaca;
- melihat HTTP status/error callback;
- melihat attempt/max attempt;
- Replay webhook.

## Admin Control Center
Route:

`/admin-webhook-control`

Admin dapat:
- melihat notifikasi operasional seluruh partner;
- melihat jumlah RETRY_PENDING dan DEAD;
- filter delivery berdasarkan Partner ID dan status;
- Replay webhook;
- melihat hubungan `replayOf` pada delivery baru.

## Replay audit-safe
Replay tidak mengubah delivery lama. Sistem membuat Delivery ID baru, menyimpan `replayOf` dan `replayedBy`, lalu mengirim payload dengan `delivery_id` baru. Dengan demikian bukti kegagalan asli tetap tersedia untuk audit.

## Retry otomatis
Retry terjadwal tetap berjalan seperti sebelumnya. Replay manual adalah jalur tambahan dan tidak menghapus retry history.

## Keamanan
- halaman Partner memakai signed partner session;
- halaman Admin memakai signed admin session;
- POST action memeriksa same-origin;
- Partner replay wajib cocok dengan Partner ID pemilik delivery;
- callback tetap wajib HTTPS dan perlindungan SSRF/private network tetap aktif;
- webhook signing secret tidak ditampilkan di Control Center.

## Email / WhatsApp
Versi ini adalah notification center internal. Email dan WhatsApp belum dikirim ke provider eksternal sampai provider/channel resmi Libra dikonfigurasi. Core notification sengaja dipisahkan agar channel eksternal dapat ditambahkan tanpa mengubah sumber event operasional.
