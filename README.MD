# Page2Copier

Simpan halaman web apa pun sebagai file PDF, PNG, atau HTML mandiri yang bersih persis seperti yang Anda lihat di layar.  
Teks dapat dipilih, tautan tetap aktif, gaya CSS tersemat rapi, dan tidak ada konten yang terpotong.

---

## Mengapa Versi 2 Hadir

Versi 1 menggunakan `html2canvas`, yang membaca DOM halaman dan merender ulang menggunakan implementasi CSS-nya sendiri yang terbatas. Fitur-fitur CSS modern yang tidak didukung akan hilang begitu saja: *backdrop-filter*, *blend-mode*, `position: sticky`, trik CSS Grid modern, elemen canvas, dan gambar *cross-origin*. Hal tersebut sering menyebabkan tata letak rusak, area kosong, atau konten hilang.

Versi 2 merombak total pendekatan tersebut. Ekstensi ini tidak lagi memakai pustaka perender eksternal. Page2Copier mengontrol mesin perender Chrome secara langsung melalui Chrome DevTools Protocol (CDP). Dengan demikian, piksel dan teks pada file hasil ekspor dihasilkan langsung dari mesin perender yang sama dengan yang menampilkan tab di browser Anda. Selain itu, Page2Copier dilengkapi fitur ekspor HTML mandiri (*clean standalone HTML*) yang menyertakan stylesheet CSS, status formulir, serta gambar tanpa skrip runtime yang tidak perlu.

---

## Dua Mode Penangkapan PDF

| Fitur | Mode Teks (*Text mode*) | Mode Snapshot (*Snapshot mode*) |
| --- | --- | --- |
| **Mesin** | `Page.printToPDF` (alur cetak browser) | `Page.captureScreenshot` (kompositor) |
| **Teks** | Teks asli, bisa dipilih dan dicari | Raster / berbasis gambar |
| **Tautan** | Aktif secara native | Aktif (ditambahkan sebagai area tautan PDF) |
| **Ukuran File** | Ringan, hanya puluhan kilobyte | Lebih besar, satu gambar per halaman |
| **Cocok Untuk** | Artikel, dokumen, struk/faktur, teks yang perlu dicari | Canvas, WebGL, peta, grafik, *blend mode*, efek *blur* |

Mode Teks adalah mode bawaan (*default*), yang menggunakan **emulasi media layar (screen media emulation)** alih-alih media cetak (*print media*). Hal ini membuat hasil cetak tetap mempertahankan tampilan desain web aslinya dan tidak dirusak oleh stylesheet cetak (*print CSS*) situs yang usang.

---

## Masalah yang Diperbaiki Secara Otomatis

Sebagian besar alat "halaman web ke PDF" mengalami masalah yang sama. Page2Copier menanganinya secara otomatis sebelum dokumen dirender:

- **Konten terpotong di tepi kanan**: Tata letak disesuaikan skalanya agar lebar penuh dokumen pas dengan ukuran lembaran kertas.
- **Setengah halaman hilang**: Halaman di-*scroll* secara otomatis dari atas ke bawah terlebih dahulu agar *lazy loading*, *infinite feed*, dan gambar yang dipicu viewport termuat sepenuhnya.
- **Gambar yang tidak muncul**: Gambar yang ditunda (*deferred images*) dan font web dipaksa termuat dan ditunggu hingga selesai.
- **Banner persetujuan cookie & pop-up**: Pop-up persetujuan cookie, balon obrolan (*chat widgets*), bar instalasi aplikasi, dan overlay buletin dibersihkan.
- **Header sticky yang menumpuk di setiap halaman**: Elemen yang melayang (*pinned/sticky*) diubah menjadi posisi normal agar hanya muncul satu kali di posisi aslinya.
- **Panel konten hanya menampilkan beberapa baris**: Area gulir internal (*inner scroll*) dibuka penuh dan elemen `<details>` yang tertutup akan dibuka.
- **Tabel dan blok kode terpotong di tengah baris**: Pemotongan halaman menghindari memotong gambar, tabel, gambar ilustrasi (*figure*), dan blok kode preformatted.

Setiap perubahan di atas dicatat dan dikembalikan ke kondisi semula tepat setelah penangkapan selesai. Kondisi tab browser Anda tetap bersih seperti semula.

---

## Fitur Utama

### Penangkapan (Capture)
- **Simpan Halaman sebagai PDF**: Mendukung mode teks maupun snapshot.
- **Simpan Halaman sebagai HTML**: Mengekspor seluruh halaman menjadi satu file HTML mandiri yang bersih (*self-contained*), dengan CSS tersemat (*inline*), elemen canvas diubah menjadi gambar, URL diubah menjadi absolut, dan script dihapus agar aman dibuka secara luring (*offline*).
- **Simpan Halaman sebagai PNG**: Menangkap seluruh halaman web menjadi gambar PNG beresolusi tinggi dengan penggabungan multi-irisan (*multi-slice stitching*) otomatis untuk halaman yang sangat panjang.
- **Pemilih Elemen (Element Picker - PDF, PNG & HTML)**: Arahkan kursor untuk menyorot blok elemen, gunakan tombol panah untuk memperluas/mempersempit area, tekan tombol `M` untuk beralih mode (PDF, PNG, atau HTML), lalu klik untuk menyimpan elemen tersebut saja.
  - Mode PDF: Ukuran kertas disesuaikan tepat dengan ukuran elemen.
  - Mode PNG: Menyimpan gambar potongan (*crop*) elemen dengan resolusi tajam.
  - Mode HTML: Mengekstrak elemen HTML mandiri lengkap dengan computed styles, CSS stylesheets, variabel custom, dan URL aset yang telah diresolusikan.
- **Seleksi Teks**: Simpan hanya bagian teks yang sedang Anda sorot/blok.
- **Mode Baca (Reader Mode)**: Mengambil artikel utama saja dengan tipografi buku yang rapi serta kop informasi judul, situs, dan tanggal.
- **Ekspor Massal (Batch)**: Simpan semua tab yang sedang terbuka di jendela browser ke dalam satu folder bertanggal.
- **Halaman Tertaut**: Klik kanan tautan apa pun untuk langsung menyimpannya tanpa harus berpindah halaman.

### Pengaturan Output
- Ukuran lembar: A4, Letter, Legal, Tabloid, A3, A5, atau ukuran pas sesuai lebar halaman web.
- Orientasi tegak (*portrait*) atau mendatar (*landscape*), dilengkapi 4 pilihan preset margin.
- Pilihan satu lembar bersambung tanpa jeda halaman (*continuous sheet*).
- Header dan footer opsional (judul, URL, nomor halaman, dan tanggal).
- Pilihan tema terang atau gelap melalui emulasi `prefers-color-scheme`.
- Kustomisasi lebar resolusi tata letak untuk merender tampilan desktop pada situs responsif.
- Kualitas snapshot tanpa kompresi (*lossless*) atau kualitas yang dapat disesuaikan hingga resolusi 4x.

### Alur Kerja & Pintasan Keyboard
- **Preset per Situs**: Simpan preferensi khusus untuk domain tertentu secara otomatis.
- Format penamaan file dinamis: `{title}`, `{domain}`, `{path}`, `{date}`, `{time}`.
- Subfolder unduhan yang dapat ditentukan.
- Pintasan keyboard bawaan:
  - `Alt+Shift+P`: Simpan halaman sebagai PDF.
  - `Alt+Shift+S`: Simpan halaman sebagai HTML.
  - `Alt+Shift+I`: Simpan halaman sebagai PNG.
  - `Alt+Shift+E`: Buka pemilih elemen (*Element Picker*).
- Menu klik kanan (konteks) untuk akses cepat ke semua fungsi ekspor.
- Status progres ditampilkan langsung di halaman web, sehingga tetap berjalan meski popup ditutup.

---

## Cara Pasang

1. Unduh atau clone repositori ini:
   ```bash
   git clone https://github.com/webmestudio/page2copier.git
   ```
2. Buka **`chrome://extensions`** pada browser Chrome atau browser berbasis Chromium lainnya.
3. Aktifkan sakelar **Mode pengembang** (*Developer mode*) di pojok kanan atas.
4. Klik tombol **Muat yang belum dibongkar** (*Load unpacked*) dan pilih folder proyek ini.

> Ekstensi ini tidak memerlukan proses *build* atau instalasi dependensi (`node_modules`). Kode di dalam repositori dapat langsung dijalankan.

---

## Informasi Izin Debugger

Page2Copier membutuhkan izin `debugger` karena ini merupakan satu-satunya cara bagi ekstensi browser untuk mengakses perintah `Page.printToPDF` dan `Page.captureScreenshot` pada Chromium DevTools Protocol.

Saat proses penangkapan sedang berlangsung, browser akan menampilkan notifikasi bilah *"Page2Copier is debugging this browser"*. Notifikasi ini akan otomatis hilang setelah proses penangkapan selesai (biasanya hanya 1-2 detik). Ekstensi ini hanya terhubung ke tab yang Anda pilih dan langsung memutuskan koneksi melalui blok `finally` demi keamanan.

---

## Privasi

Seluruh pemrosesan dilakukan secara lokal di perangkat Anda. Tidak ada server eksternal, analitik, telemetri, ataupun permintaan jaringan yang dikirimkan ke luar. Halaman dirender secara lokal dan file langsung disimpan ke folder unduhan Anda.

---

## Struktur Folder

```
manifest.json              Manifest konfigurasi ekstensi
icons/                     Ikon ekstensi
src/
  background/
    service-worker.js      Titik masuk, manajemen tab, progres, dan menu konteks
    capture.js             Alur logika penangkapan PDF, PNG, dan HTML
    cdp.js                 Wrapper Promise untuk chrome.debugger
    prepare.js             Skrip injeksi untuk pembersihan halaman sebelum capture
    pdf-writer.js          Pembuat file PDF mandiri tanpa dependensi untuk mode snapshot
    settings.js            Pengaturan default dan preset per situs
    download.js            Format nama file dan proses penyimpanan
  content/
    picker.js              Overlay visual untuk pemilih elemen
    hud.js                 Indikator status progres di dalam halaman
  ui/
    popup.html/.js         Tampilan popup utama
    options.html/.js       Halaman pengaturan opsi
    glass.css              Sistem desain antarmuka
    offscreen.html/.js     Helper blob URL untuk proses unduhan
store/                     Materi dokumentasi dan aset store
```

---

## Batasan yang Diketahui

- Ekstensi Chrome tidak dapat berjalan pada halaman internal browser seperti `chrome://`, halaman Chrome Web Store, atau halaman ekstensi lain karena pembatasan keamanan dari Chrome.
- Jika panel DevTools sedang terbuka pada tab target, *debugger* tidak dapat terhubung. Tutup DevTools terlebih dahulu sebelum melakukan penangkapan.
- Dokumen yang memiliki panjang lebih dari sekitar 200 inci akan dibagi ke dalam beberapa halaman PDF karena batasan batas format spesifikasi PDF.

---

## Lisensi

Proyek ini dilisensikan di bawah lisensi [MIT](LICENSE).
