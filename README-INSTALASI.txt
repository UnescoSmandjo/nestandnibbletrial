NEST & NIBBLE - PAKET WEBSITE DENGAN LOGIN + DATABASE CLOUD

ISI FILE
- index.html        halaman aplikasi kasir
- app.css           CSS utama terpisah dari HTML
- login.html        halaman login
- login.css         CSS halaman login terpisah
- functions/_middleware.js  proteksi halaman dan API dengan sesi login
- functions/api/login.js    validasi akun di server
- functions/api/logout.js   logout dan hapus cookie sesi
- functions/api/data.js     API baca/simpan data ke Cloudflare D1
- migrations/0001_init.sql  struktur tabel database

DATA YANG DISIMPAN
Seluruh objek aplikasi (transaksi/riwayat, menu, pengaturan, absensi, stok opname, kas, dan nomor urut transaksi) disimpan sebagai satu snapshot JSON di Cloudflare D1. Data tetap ada walau browser dihapus, HP diganti, atau pegawai login dari perangkat lain. Laporan bulanan mengambil transaksi berdasarkan tanggal transaksi yang sudah tersimpan.

CARA UPLOAD KE GITHUB
1. Ekstrak ZIP ini.
2. Upload/ganti semua file dan folder di atas ke ROOT repository UnescoSmandjo/nestandnibbletrial, branch main. Jangan taruh functions/ di dalam subfolder lain.
3. Pastikan Cloudflare Pages project terhubung ke repository dan build output directory kosong/root sesuai konfigurasi project.
4. Di Cloudflare Dashboard > Workers & Pages > nestandnibbletrial > Settings > Bindings, tambahkan D1 database binding:
   Variable name: DB
   D1 database: pilih database yang akan dibuat pada langkah berikutnya.
5. Buat D1 database melalui Workers & Pages > D1 SQL Database > Create database. Nama contoh: nest-nibble-db.
6. Buka database > Console, jalankan isi file migrations/0001_init.sql satu kali.
7. Tambahkan Variables and Secrets pada Pages project:
   STAFF_USERS (Secret): masukkan JSON akun yang diberikan di chat. Jangan masukkan nilainya ke file repository atau commit GitHub.
   SESSION_SECRET (Secret): string acak panjang minimal 32 karakter. Buat dengan password manager, jangan gunakan password akun pegawai.
8. Save lalu redeploy project. Pastikan binding DB tersedia di Production (dan Preview jika dites di Preview).
9. Buka https://nestandnibbletrial.pages.dev/ lalu login. Cek tulisan "Data tersimpan di cloud" di header.

PENTING SAAT MIGRASI DATA LAMA
Saat pertama kali membuka versi baru, aplikasi akan mengirim data localStorage dari perangkat pertama yang berhasil membuka aplikasi ke D1 jika database masih kosong. Karena itu, sebelum deploy, buka aplikasi lama di perangkat yang menyimpan data paling lengkap dan gunakan fitur Ekspor/Backup di Setelan. Jangan hapus data browser lama sampai login versi baru berhasil dan data lama terlihat. Jika database sudah terisi, data lokal perangkat lain tidak otomatis menimpa data cloud.

CATATAN PENTING
- Data di server disimpan di D1; jangan hapus database atau tabel app_state.
- Data di satu database dibagi oleh semua pegawai dan owner yang login ke project yang sama.
- Simpan backup JSON/CSV berkala dari menu Setelan, terutama sebelum reset atau perubahan besar.
- Versi ini memakai snapshot bersama. Hindari dua perangkat mengedit pengaturan/menu yang sama pada detik bersamaan; perubahan terakhir dapat menimpa perubahan non-transaksi dari perangkat lain. Transaksi/riwayat di snapshot akan tersimpan dan tetap tersedia untuk rekap bulanan.
- Password contoh masih pendek. Ganti password setelah sistem terpasang. Batasi percobaan login dengan Cloudflare WAF rate limiting pada POST /api/login.
- Jika binding DB belum dibuat, login tetap bisa berjalan tetapi penyimpanan cloud akan menampilkan error.
