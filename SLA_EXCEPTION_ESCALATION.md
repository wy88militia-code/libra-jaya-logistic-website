# SLA Exception & Escalation Engine — Libra Jaya Logistic

## Tujuan
Mendeteksi risiko keterlambatan sebelum pelanggan komplain dan memberi prioritas kerja kepada Admin/OPS.

## Status warna
- GREEN: kiriman masih on track.
- YELLOW: mendekati batas SLA, tracking terlalu lama tidak diperbarui, atau connecting flight belum mencapai milestone yang semestinya.
- RED: risiko tinggi, status HELD/DAMAGED/CLAIM_PROCESS, tracking sangat stale, connecting flight tertinggal jauh, atau SLA sudah terlewati.

Status delivered tetap disimpan untuk KPI `DELIVERED_ON_TIME` / `DELIVERED_LATE`.

## Perhitungan SLA
Engine membaca `sla` dari Booking/Quote. Format seperti `1-2 hari`, `24 jam`, `48 hours`, atau `H+2` dikenali. Untuk rentang, batas maksimum digunakan sebagai due time.

Cut-off memakai `cutoffWit` dari Quote/Rate Plan. Bila booking dibuat setelah cut-off WIT, awal estimasi SLA digeser +24 jam. Ini adalah model operasional konservatif sampai kalender kerja/libur khusus diterapkan.

## Connecting flight
Engine mendeteksi skema connecting/flight/udara serta rute Wamena/WMX. Bila >60% SLA sudah terpakai tetapi milestone connecting belum tercatat, status dapat naik ke YELLOW. Bila >80% SLA terpakai tetapi belum tiba di hub tujuan, status dapat naik ke RED.

## Stale tracking
Batas stale menyesuaikan panjang SLA. Tracking yang terlalu lama tidak diperbarui meningkatkan risiko walaupun due time belum terlewati.

## Alert
- YELLOW: Notification Center Admin Libra.
- RED / SLA_BREACH: Notification Center Admin dan, bila external alert sudah dikonfigurasi, ikut masuk jalur external CRITICAL alert.
- Partner tidak otomatis diberi pesan keterlambatan sebelum OPS memverifikasi kondisi.
- Recovery RED/YELLOW → GREEN dicatat sebagai `SLA_RECOVERED`.

## Scheduling
`scheduled-sla-monitor.mjs` berjalan setiap 15 menit dan hanya mengantrekan background worker. Tracking update juga langsung memicu evaluasi SLA ulang sehingga HELD/DAMAGED/DELIVERED tidak menunggu scheduler.

## Admin
Halaman: `/admin-sla-control`

Menyediakan ringkasan Active, Green, Yellow, Red, Breached, on-time delivered, filter risk/partner, due time WIT, last tracking, connecting-flight flag, dan alasan eskalasi.

## Backup
Store `libra-sla-monitor` masuk protected Disaster Recovery snapshot.
