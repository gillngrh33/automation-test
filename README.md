# Automation Test

Project ini berisi automated test berbasis [Playwright](https://playwright.dev/) untuk menguji aplikasi portfolio pada folder `portfolio`.

## Cakupan Test

Test mencakup fitur-fitur berikut:

- Halaman public portfolio
- Login admin
- Identity
- Education
- Experience
- Organization
- Certification
- CV

## Prasyarat

- Node.js dan npm
- Project portfolio sudah ter-install dan dapat dijalankan
- Docker dan Docker Compose jika ingin menjalankan test melalui Docker

## Instalasi

Jalankan perintah berikut dari folder project ini:

```bash
cd automation-test
npm install
npx playwright install
```

Sebelum menjalankan test, pastikan aplikasi portfolio sudah berjalan. Dari folder `portfolio`, jalankan:

```bash
npm install
npm run dev
```

Aplikasi biasanya tersedia di `http://localhost:3001`.

## Konfigurasi Environment

Buat file `.env` di dalam folder `automation-test`:

```env
BASE_URL=http://localhost:3001
ADMIN_USERNAME=<your-username>
ADMIN_PASSWORD=<your-password>
```

`BASE_URL` menentukan alamat aplikasi yang dites. `ADMIN_USERNAME` dan `ADMIN_PASSWORD` harus diisi dengan kredensial admin yang tersedia secara lokal. Jangan commit file `.env` atau membagikan nilainya.

## Menjalankan Test

Jalankan perintah dari folder `automation-test`:

```bash
npm test
```

Menjalankan test pada Chromium dan WebKit.

```bash
npm run test:all
```

Menjalankan test pada seluruh browser dan device yang dikonfigurasi.

```bash
npm run test:headed
```

Menjalankan test dengan browser terlihat.

```bash
npm run test:report
```

Membuka HTML report dari hasil test terakhir.

## Menjalankan dengan Docker

Untuk menjalankan test menggunakan Docker:

```bash
npm run test:docker
```

Secara default, container mengakses aplikasi portfolio melalui `host.docker.internal` pada port `80`. Jika aplikasi portfolio berjalan pada port development `3001`, atur port sebelum menjalankan test.

PowerShell:

```powershell
$env:PORTFOLIO_CLIENT_PORT="3001"
npm run test:docker
```

Linux/macOS:

```bash
PORTFOLIO_CLIENT_PORT=3001 npm run test:docker
```

Report dan hasil test akan tersedia pada folder `playwright-report` dan `test-results`.

## Catatan

- Test menggunakan `BASE_URL` dari file `.env`; jika tidak diatur, default-nya adalah `http://localhost:3001`.
- Test admin membutuhkan `ADMIN_USERNAME` dan `ADMIN_PASSWORD`.
- Screenshot, video, dan trace disimpan ketika test gagal.
