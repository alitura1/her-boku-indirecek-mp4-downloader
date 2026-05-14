# her boku indirecek mp4 downloader

Açık kaynak, yt-dlp tabanlı video / ses indirici. YouTube, TikTok, X (Twitter), Instagram, Reddit, Facebook, Vimeo, Twitch ve 1000+ siteden mp4 / mp3 / webm indirir. Next.js 15 + TypeScript + Tailwind.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/alitura1/her-boku-indirecek-mp4-downloader)

## Nasıl çalışır

Sunucu video byte'larını taşımaz. yt-dlp sadece kaynak CDN'in **direct URL**'ini çıkartır ve client'a verir; tarayıcı dosyayı doğrudan kaynaktan indirir. Bu sayede:

- Vercel function timeout'una takılmaz.
- Vercel bandwidth maliyeti çıkmaz.
- Büyük dosyalar bile (1080p / 4K) sorunsuz iner.

```
URL → /api/extract → yt-dlp --dump-json → format listesi → client direkt CDN'den indirir
```

## Önemli uyarı: YouTube ve Vercel

YouTube, Vercel/AWS/GCP gibi datacenter IP'lerini agresif olarak bloklar — "Sign in to confirm you're not a bot" hatası verir. **YouTube indirmek istiyorsan self-host şart.** Diğer siteler (TikTok, X, Instagram, Reddit, Facebook, Vimeo...) Vercel'de büyük oranda çalışır.

## Local çalıştırma

Gereksinimler: Node.js 20+, Python 3 (yt-dlp için), ffmpeg (opsiyonel; merge gereken format'lar için).

```bash
git clone https://github.com/alitura1/her-boku-indirecek-mp4-downloader
cd her-boku-indirecek-mp4-downloader
npm install
npm run dev
# http://localhost:3000
```

`youtube-dl-exec` paketinde bilinen bir bug var: postinstall yt-dlp binary'sini indirirken `debug` modülünü bulamayabiliyor. `npm install` hata verirse:

```bash
npm install --ignore-scripts
npm install debug --ignore-scripts
node node_modules/youtube-dl-exec/scripts/postinstall.js
```

## Vercel deploy

```bash
vercel
# veya tek tıkla:
```

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/alitura1/her-boku-indirecek-mp4-downloader)

Vercel ayarları:
- Function timeout: `vercel.json`'da 60sn (Pro plan). Hobby plan'da otomatik 10sn'ye düşer.
- Build size: yt-dlp binary ~30MB; `outputFileTracingIncludes` ile dahil edilir.

## Self-host (Docker)

YouTube'un gerçek anlamda çalışacağı yer burası. Residential IP'in varsa hiç engelle karşılaşmazsın.

```bash
docker compose up -d --build
# http://localhost:3000
```

Veya doğrudan:

```bash
docker build -t mp4-downloader .
docker run -d -p 3000:3000 --restart unless-stopped mp4-downloader
```

VPS önerileri: Hetzner Cloud (€4/ay), DigitalOcean droplet, Oracle Free Tier. Cloudflare Tunnel ile public erişim açabilirsin.

### Proxy desteği

YouTube'da hâlâ block yiyorsan residential proxy ekle:

```bash
docker run -e YTDLP_PROXY=http://user:pass@proxy:port -p 3000:3000 mp4-downloader
```

(`app/api/extract/route.ts` içindeki `youtubedl()` çağrısına `proxy: process.env.YTDLP_PROXY` ekle.)

## Mimari

```
app/
├── api/extract/route.ts    # POST URL → yt-dlp dumpJson → format listesi
├── page.tsx                # Tek sayfalık UI (URL input + format tablosu)
└── layout.tsx
lib/
└── formats.ts              # Format normalizasyon + human-readable helper'lar
```

## Yasal uyarı (DMCA)

Bu araç sadece **kişisel ve yasal kullanım** içindir:
- Kendi içeriklerini yedeklemek
- Creative Commons / public domain içerikleri arşivlemek
- Fair use kapsamındaki kullanım

Telif hakkı korumalı içeriği izinsiz indirmek, dağıtmak veya yeniden yayınlamak **YASAKTIR** ve birçok ülkede suçtur. YouTube vb. platformların ToS'unu indirme yasakları içerebilir — sorumluluk kullanıcıdadır.

Bir DMCA takedown notice alırsan: bana ulaş, ilgili kullanım örneklerini (varsa) repo'dan kaldırırım. Araç yt-dlp'nin yasal yetkisinin altında çalışıyor, kendisi telifli içerik dağıtmıyor.

## Lisans

[MIT](LICENSE)

## Teşekkürler

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — bu projenin tüm gücü
- [youtube-dl-exec](https://github.com/microlinkhq/youtube-dl-exec) — Node wrapper
- [cobalt.tools](https://cobalt.tools) — UI ilhamı
