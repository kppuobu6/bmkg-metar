# Cloudflare Worker: BMKG METAR Proxy

Worker ini berfungsi sebagai proxy untuk mengakses data METAR dari BMKG. Karena BMKG menggunakan Cloudflare yang memblokir request dari server Vercel, worker ini berjalan di jaringan Cloudflare sendiri sehingga tidak diblokir.

## Mengapa Perlu Worker ini?

- **aviationweather.gov** tidak punya data untuk bandara kecil Indonesia (WIGG, WIJJ, dll)
- **BMKG** memblokir request dari IP server Vercel (Cloudflare protection)
- Cloudflare Worker berjalan di jaringan CF sendiri → tidak diblokir

## Setup (5 menit)

### 1. Buat Akun Cloudflare (gratis)

Buka https://dash.cloudflare.com/sign-up dan daftar akun gratis.

### 2. Buat Worker

1. Login ke Cloudflare Dashboard
2. Klik **Workers & Pages** di sidebar
3. Klik **Create Application** → **Create Worker**
4. Beri nama (contoh: `bmkg-metar-proxy`)
5. Klik **Deploy**

### 3. Edit Worker Code

1. Klik **Edit Code** di worker yang baru dibuat
2. Copy-paste isi file `worker.js` di atas
3. Klik **Save and Deploy**

### 4. Copy Worker URL

Worker URL-nya seperti:
```
https://bmkg-metar-proxy.your-username.workers.dev/metar
```

### 5. Set Environment Variable di Vercel

1. Buka project Vercel kamu
2. Klik **Settings** → **Environment Variables**
3. Tambah variable baru:
   - **Name:** `BMKG_PROXY_URL`
   - **Value:** `https://bmkg-metar-proxy.your-username.workers.dev/metar`
   - **Environment:** Production, Preview, Development
4. Klik **Save**
5. **Redeploy** project Vercel

## Verifikasi

Setelah deploy, coba search WIGG atau WIJJ lagi. Seharusnya sudah bisa.

## Biaya

- **Cloudflare Workers Free Tier:** 100,000 request/hari (GRATIS)
- Tidak perlu kartu kredit

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Masih 403 | Pastikan BMKG_PROXY_URL sudah benar dan worker sudah deployed |
| Worker timeout | Cek log worker di Cloudflare Dashboard → Workers & Pages → Logs |
| CORS error | Worker sudah include CORS headers, cek browser console |
