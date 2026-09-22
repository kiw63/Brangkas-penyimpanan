# BRANKAS V2

V2 adalah aplikasi full-stack, bukan hanya HTML. Struktur:
- `public/` = UI
- `server.mjs` = backend
- `data/` = database + file vault (dibuat otomatis)

## Jalankan
1. Install Node.js 20+.
2. Jalankan `npm install`.
3. Jalankan `npm start`.
4. Buka `http://localhost:8787`.
5. Pada aktivasi pertama masukkan password minimal 12 karakter dan redeem code buatanmu.

## Dua halaman
1. Isi Brankas: upload, preview video/gambar/PDF, download ke perangkat hanya saat ditekan, hapus.
2. Video Downloader: target Vid3y dan TikTok.

## Download video — hal yang sengaja dibuat ketat
Server TIDAK menjalankan JavaScript dari URL eksternal dan TIDAK menjadi proxy sembarang URL. Ini mencegah SSRF dan berbagai risiko web-proxy.
- Vid3y: URL harus menghasilkan response `video/*`, `audio/*`, atau `image/*`. Jika `?v=...` hanya menghasilkan halaman HTML player, server menolak. Untuk membuatnya benar-benar kompatibel dengan player page, diperlukan endpoint/API resmi Vid3y atau URL media final.
- TikTok: API resmi TikTok saat ini menyediakan akses video akun yang diotorisasi melalui Login/Display API dan Data Portability, bukan API umum untuk mengunduh sembarang share URL. Karena itu endpoint default mengembalikan status bahwa OAuth/API resmi diperlukan.
- Ada adapter opsional `yt-dlp` untuk TikTok milik pengguna sendiri/yang berhak diunduh. Aktifkan `ALLOW_YTDLP=1` dan install `yt-dlp` di server. Ini tetap bergantung pada perubahan situs sumber dan bukan jaminan 100%.

## Keamanan
- Argon2id password/redeem hash.
- Helmet security headers + strict CSP.
- Session bearer tokens dengan expiry.
- Rate limiting untuk login/import.
- SSRF allowlist: hanya host yang diminta.
- Tidak mengikuti redirect pada Vid3y import.
- File disimpan di luar `public/`.
- Nama file dinormalisasi.
- Batas upload 5 GB.
- SQLite WAL.
- Tidak mengekspos storage path.
- `Cache-Control: private, no-store` pada file streaming.
- Video diputar dari authenticated endpoint dan tidak otomatis didownload ke Android.

## Produksi
Untuk benar-benar menjadi layanan cloud:
- gunakan object storage private (S3/R2/GCS) dan signed URLs;
- gunakan TLS/HTTPS;
- gunakan reverse proxy/WAF;
- simpan secret di environment/secret manager;
- gunakan database managed;
- backup terenkripsi;
- malware/content scanning sesuai kebutuhan;
- audit log;
- CSRF strategy untuk cookie sessions bila cookie dipakai;
- passkeys/WebAuthn + MFA;
- rotasi session dan key;
- encryption-at-rest di storage dan, bila dibutuhkan, client-side E2EE dengan desain kunci yang diaudit.

Tidak ada aplikasi web yang bisa dijamin “100% aman” atau downloader yang bisa dijamin “100% kompatibel” terhadap situs pihak ketiga yang dapat berubah sewaktu-waktu.
