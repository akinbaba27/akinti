# AKINTI — Devir Rehberi (Handover)

Bu doküman, bu repoyu hiç görmemiş ama deneyimli bir geliştirici için yazıldı.
Amaç: sıfırdan makinede projeyi ayağa kaldırmak, ne bittiğini ne açık
olduğunu anlamak, yayına almak. Türkçe. Doğrulanamayan hiçbir şey burada
"kesin" olarak yazılmadı — böyle bir yer varsa açıkça **doğrulanmadı**
işaretlenmiştir. Komutların tamamı `package.json` ve ilgili dokümanlardan
alınmıştır, tahmin edilmemiştir.

Devam eden günlük çalışma notu (Türkçe, İngilizce özetinden çok daha
ayrıntılı, ajan bazlı): [`docs/HANDOFF.md`](HANDOFF.md). Bu dosya onun yerini
tutmaz — bu doküman "buraya nasıl gelinir ve nasıl devam edilir" içindir,
HANDOFF.md ham geçmiş kayıttır.

---

## (a) Bu proje ne

AKINTI, ses-öncelikli bir sosyal ağ: kullanıcılar şarkı/konuşma/beste
kaydediyor veya yüklüyor ("**Wave**"), başkaları dinliyor (Play/Replay),
kaydediyor (Save), yorumluyor, paylaşıyor ve **Duet** (işbirlikli, eşzamansız
cevap kaydı) isteyebiliyor. Beğeni (Like) yok, foto/video paylaşımı yok.

**Ne bitti:** backend uçtan uca canlı bir Supabase projesinde doğrulandı (42+
migration, RLS, auth, storage, worker, Play/Replay sayaçları, moderasyon,
rate limit, bildirimler, mesajlaşma); tüm v2 ekranları (Flow, Explore, Record/
Enhance/Publish, Wave sayfası, Duet — Layer/Atışma/Cypher, Challenges, Pro
ödeme akışı — iyzico + Paddle, PWA/Serwist, Türkçe/İngilizce i18n) inşa edildi
ve bağımsız QA turlarından geçti; ~900 birim testi, uçtan uca Playwright
senaryoları (gerçek Supabase karşı, `E2E_SUPABASE=1`) yeşil.

**Ne açık:** son QA raporu (`docs/qa/full2/REPORT.md`, 7/10) 4 P1 ve 5 P2
bulgu bırakmıştı — 2026-09-09'da bir sonraki oturumda hepsinin **zaten
`fixQA2` dalgasıyla çözüldüğü** doğrulandı (bu doküman fixQA2'den sonra
yazılmış ama listesi güncellenmemiş kalmıştı); Flow/Explore TBT de aynı
oturumda sessiz bir host'ta yeniden ölçülüp doğrulandı — Flow çözülmüş
sayılır. Explore'un 2026-09-09 turunda 3 run'dan 1'i 1,602ms'e sıçramıştı;
2026-09-13'te 3 run daha (`docs/qa/tbt3/TBT.md`) hiçbiri tekrarlamadı (682/
524/476ms), 6 run'ın 5'i <1000ms — **artık tamamen çözülmüş sayılıyor**
(bkz. bölüm (j) P1 #4). Ayrıca gerçek cihazda mikrofonla Flow/Duet dinleme testi ve
iyzico/Paddle sandbox ödeme testi hâlâ yapılmadı, `akinti.app` alan adı
bağlanmadı. **Anahtar rotasyonu 2026-09-09'da tamamlandı** (bkz. bölüm (i)) —
`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` artık Supabase'in
yeni `sb_secret_`/`sb_publishable_` anahtar formatında, DB şifresi yenilendi,
eski (sızmış) legacy JWT anahtarları panelden kalıcı devre dışı.

---

## (b) Sıfır bilgisayarda kurulum

Sırayla, adım adım. Windows notları her adımın altında.

### 1. Git ve repoyu klonlama

```bash
git clone https://github.com/alpbazoglu/akinti.git
cd akinti
```

Repo **özel** (private) — GitHub hesabına davet edilmen gerekiyor (founder
Supabase panelinden ayrıca projeye de üye ekleyecek, bkz. bölüm (d)). Repo
kökü doğrudan bu `app/` klasörü — ayrı bir monorepo kökü yok.

### 2. Node 22

`.nvmrc` dosyası `22` içeriyor; `package.json#engines` `>=20.9.0` gerektiriyor
(Next 16'nın kendi minimum sürümüyle aynı).

```bash
nvm install
nvm use
node -v   # 22.x olmalı
```

**Windows notu:** `nvm-windows` kullanıyorsan `nvm install 22 && nvm use 22`.
PowerShell'de `.nvmrc` otomatik okunmaz, sürümü elle belirt.

### 3. Bağımlılıklar

```bash
npm ci
```

`npm install` değil `npm ci` — `package-lock.json` kilitli, sürüm sürprizi
istemiyoruz.

### 4. ffmpeg + ffprobe (worker için zorunlu)

`scripts/worker.ts` sistemde kurulu bir `ffmpeg`/`ffprobe` bekliyor, **hiçbir
fallback yok** — eksikse her iş açıkça başarısız olur (sahte "tamam" asla
gösterilmez). Bu geliştirme ortamında ffmpeg **9.0.1** ile test edildi
(`docs/qa/full2/REPORT.md`); kodda sabit bir sürüm zorunluluğu yok, güncel bir
ffmpeg 6+ yeterli olmalı ama **doğrulanmadı**.

- **Windows:** `winget install Gyan.FFmpeg` veya https://www.gyan.dev/ffmpeg/builds/
  'dan indirip `bin/` klasörünü PATH'e ekle. `ffmpeg -version` ve
  `ffprobe -version` ayrı bir terminalde çalışmalı.
- **macOS:** `brew install ffmpeg`.
- **Linux:** `apt install ffmpeg` (veya dağıtımına göre).

Farklı bir yoldaysa `.env.local`'da `FFMPEG_PATH`/`FFPROBE_PATH` ile
override edilebilir (`.env.example`).

### 5. Python 3.12 + sidecar venv (isteğe bağlı ama Pro sesleri için gerekli)

Sidecar (`sidecar/`), DeepFilterNet3 gürültü temizleme, Matchering mastering
ve librosa pYIN pitch skorlama yapan ayrı bir FastAPI süreci — worker ona
yerel HTTP üzerinden bağlanıyor, hiçbir Node kodu onu import etmiyor (GPL-3.0
izolasyonu, bkz. `sidecar/README.md`). **Zorunlu değil**: sidecar
çalışmıyorsa worker `arnndn`/`loudnorm` ile dürüst bir fallback'e düşüyor —
**tek istisna** AKINTI Pro'nun iki sesi (pitch snap, self-harmony): bunlar
yerel karşılığı olmadığı için sidecar yoksa iş sessizce düşük kaliteye
inmez, açıkça başarısız olur ve tekrar dener.

```bash
cd sidecar
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
cd ..
npm run sidecar    # repo kökünden; .venv varsa onu, yoksa sistem python'ı kullanır
```

Bu makinede (Windows, Python 3.12, Rust yok) doğrulanan durum: `matchering`
ve diğer her şey kuruluyor; `deepfilternet` Rust/Cargo gerektirdiği için
kurulmuyor ve otomatik olarak ffmpeg `arnndn` + gömülü RNNoise modeline
düşüyor (`sidecar/models/rnnoise.rnnn`) — kod değişikliği gerekmeden, Linux'ta
Rust toolchain varsa (örn. `Dockerfile.sidecar`) gerçek DeepFilterNet3
kurulur. `GET http://127.0.0.1:8011/health` hangi yeteneğin gerçekten
çalıştığını raporlar — güven kaynağı bu, doküman değil.

**Windows notu:** Rust kurup `deepfilternet`'i gerçekten çalıştırmak
istersen `rustup` kur, ama bu makinede test edilmedi ve zorunlu değil.

### 6. Docker — isteğe bağlı

Sadece worker/sidecar'ı container içinde çalıştırmak veya yerel Supabase
(`supabase start`) kullanmak istersen gerekli. `Dockerfile.worker`,
`Dockerfile.sidecar`, `docker-compose.worker.yml` hazır — bkz. bölüm (i).
Bu geliştirme ortamında Docker hiç kullanılamadı, migration'lar canlı
Supabase'e karşı doğrulandı, yerel `supabase start`/`db reset` hiç
**denenmedi** — ilk fırsatta bir deneyip `docs/DATABASE.md`/`supabase/README.md`'yi
güncellemek iyi bir ilk iş olur.

### 7. Ortam değişkenleri

```bash
cp .env.example .env.local
npm run check-env
```

Hangi değişken nereden gelir, hangisi zorunlu: bölüm (c).

### 8. Doğrulama

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Hepsi backend'siz (Supabase anahtarı olmadan) yeşil olmalı — `npm run build`
Supabase değişkenleri boşken bile başarılı olacak şekilde tasarlandı (bkz.
bölüm (c)).

---

## (c) `.env.local`

**Asla commit edilmez** (`.gitignore`'da). Founder'dan Slack/1Password/vb. gibi
ayrı bir kanaldan gelir, sohbet geçmişine veya bu repoya asla yapıştırılmaz —
bu projede daha önce tam olarak bu hata yapıldı ve anahtar rotasyonu bu
yüzden yayın öncesi **şart** (bkz. bölüm (i)).

Tam liste ve açıklamalar: `.env.example` (satır satır yorumlu). Özet:

### Zorunlu (web + worker)

| Değişken | Nereden | Not |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | Public, tarayıcıya gider |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Aynı yer | Public — koruma RLS'te, bu anahtarın gizliliğinde değil |
| `SUPABASE_SERVICE_ROLE_KEY` | Aynı yer | **Sunucu-only.** `NEXT_PUBLIC_` öneki ASLA eklenmez. Worker ve imzalı URL üretimi için gerekli |

Üçü de boşken uygulama **çökmez** — `isSupabaseConfigured()` false iken her
ekran dürüst "backend yapılandırılmamış" durumu gösterir (spec kuralı: sahte
başarı yok). Sadece gerçek `NODE_ENV=production` + (`VERCEL=1` veya
`REQUIRE_SUPABASE=1`) durumunda eksik anahtar boot'ta sunucuyu çökertir
(`src/instrumentation.ts`).

### İsteğe bağlı — web

- `NEXT_PUBLIC_SITE_URL` — sitemap için canonical origin, yoksa Vercel'in
  kendi `VERCEL_URL`'ine düşer.
- `REQUIRE_SUPABASE=1` — Vercel dışı bir prod host'ta boot'u sıkılaştırır.

### İsteğe bağlı — worker (`scripts/worker.ts`)

`FFMPEG_PATH`, `FFPROBE_PATH`, `WORKER_POLL_INTERVAL_MS`, `WORKER_BATCH_SIZE`,
`SIDECAR_URL` (varsayılan `http://127.0.0.1:8011`), `SIDECAR_TIMEOUT_MS`,
`SIDECAR_RETRIES`, `RNNOISE_MODEL_PATH`. **Not:** `SIDECAR_URL` grubu ya hep
ya hiç set edilmeli (`npm run check-env:groups` bunu kontrol eder) — worker
ve sidecar ayrı host'taysa `SIDECAR_URL` eksik kalırsa Pro sesleri sonsuza
kadar sessizce tekrar dener.

### Migration için (web/worker'da kullanılmaz)

`DATABASE_URL` (veya `SUPABASE_DB_URL`) — sadece `npm run db:migrate` için,
bkz. bölüm (d).

### İsteğe bağlı — Web Push

`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — üçü
eksikse push sessizce devre dışı kalır (çökme yok). Üretim: bölüm (i).

### İsteğe bağlı — AKINTI Pro ödeme (iyzico + Paddle)

`IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL` (varsayılan
sandbox), `IYZICO_MERCHANT_ID`; `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`,
`PADDLE_ENVIRONMENT`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`,
`NEXT_PUBLIC_PADDLE_ENVIRONMENT`. Eksikse ilgili sağlayıcı dürüst bir "ödeme
kurulu değil" hatası verir, asla çökmez. Plan seed'i için ayrıca
`IYZICO_PLAN_MONTHLY_TRY`/`IYZICO_PLAN_YEARLY_TRY`/`PADDLE_PRICE_MONTHLY_USD`/
`PADDLE_PRICE_YEARLY_USD` + iki `*_YEARLY_*_AMOUNT` (bkz. bölüm (d)/(i)).

`E2E_SUPABASE=1` sadece backend-bağımlı Playwright testlerini açar (bölüm
(f)).

---

## (d) Supabase

### Projeye üye olma

Founder Supabase panelinden (ref: bkz. HANDOFF.md — bu değeri sohbette
paylaşmak yerine panelden davet linkiyle ver) seni projeye ekleyecek. Ekli
olduğunda `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
`SUPABASE_SERVICE_ROLE_KEY` değerlerini Project Settings → API'den kendin
alabilirsin — bunları founder'ın ayrıca sana yapıştırmasına gerek yok, panel
erişimi yeterli.

### Migration'ları uygulama

Zaten canlı projede uygulanmış ve **2026-09-09'da gerçek bağlantıyla teyit
edildi**: `npm run db:migrate:dry` DB'ye hiç bağlanmadığı için (tasarım
gereği, sadece migration klasöründeki dosyaları listeler) pending olup
olmadığını göstermez — asıl kanıt `npm run db:migrate`'in gerçek
`DATABASE_URL` ile çalıştırılıp her 57 migration için `skipped` (zaten
uygulanmış) dönmesiydi. Yeni bir migration eklersen aynı komutla kontrol et:

```bash
npm run db:migrate:dry   # bekleyen migration'ları listeler — DB bağlantısı gerektirmez
npm run db:migrate       # bekleyen her migration'ı tek tek transaction içinde uygular
```

`db:migrate` (dry olmayan) için `DATABASE_URL` gerekir (Supabase → Project Settings → Database → Connection
string → URI, **session pooler** formu IPv4-only ağlarda — çoğu dizüstü/CI —
çalışır, direct bağlantı IPv6-only). `public.schema_migrations` tablosunda
neyin uygulandığını takip eder, tekrar çalıştırmak güvenli.

Alternatif: `supabase login && supabase link --project-ref <ref> && supabase db push`
(CLI varsa) veya Studio SQL editöründe her dosyayı sırayla yapıştırmak.
Ayrıntı: `supabase/README.md`, `docs/DEPLOYMENT.md` bölüm 1.

### Doğrulama script'leri

```bash
npm run verify:live                          # profiles/waves/audio_assets/notifications/messages erişilebilir mi, bucket'lar doğru mu
npx tsx scripts/verify-live.ts --create-buckets   # audio/avatars bucket'ları eksikse oluşturur
npx tsx scripts/verify-live-messaging.ts     # ilk DM açma regresyonu
npx tsx scripts/verify-live-delete.ts        # hesap silme cascade'i
npx tsx scripts/verify-live-challenges.ts    # challenge girişi + görünürlük RLS
npx tsx scripts/verify-live-billing.ts       # billing şeması (doğrulanmadı — script'i çalıştırıp çıktısını gözden geçir)
```

Hepsi `SUPABASE_SERVICE_ROLE_KEY` ister, gerçek veri yazabilir — bir üretim
projesine karşı dikkatli çalıştır.

### Seed sırası (idempotent, tekrar çalıştırmak güvenli — sıra önemli)

```bash
npm run seed:backing-tracks   # 1. önce — 12 CC-BY enstrümantal, audio bucket'a yükler + backing_tracks satırları
npm run seed:challenges       # 2. sonra — ilk challenge'lar, birini bir backing track ile eşleştirir
npm run seed:plans            # 3. bağımsız — plans kataloğu (önce iyzico/Paddle panelinde gerçek fiyat/plan oluşturulmalı, bkz. bölüm (i))
```

`npm run db:seed` (`supabase/seed.sql`) **prod'a asla çalıştırılmaz** —
sahte hesaplar/veri, `NODE_ENV=production` iken zaten reddediyor.

### Auth redirect URL'leri

Project Settings → Authentication → URL Configuration:
- **Site URL** → prod web app origin.
- **Redirect URLs** → `https://<domain>/auth/callback` ekle (mevcut
  `http://127.0.0.1:3000/auth/callback` yerel geliştirme için zaten var,
  **silme**, yanına ekle).
- **Confirm email** açık kalmalı (yerel dev'de `supabase/config.toml` kapatıyor,
  prod'da asla kapatma).

### Storage bucket'lar

`audio` (private, 100MB limit, imzalı URL ile okunur, listener SELECT
policy'si yok) ve `avatars` (public, 2MB) — migration 13 tarafından
oluşturuluyor, **panelden elle oluşturma**; eksikse migration 13'ü tekrar
çalıştır veya `verify-live.ts --create-buckets` kullan.

---

## (e) Çalıştırma

```bash
npm run dev            # Next dev server (Turbopack), varsayılan port 3000
npm run worker         # audio_processing_jobs kuyruğunu 5 sn'de bir yoklar, sonsuz döner
npm run worker:once    # kuyruğu bir kez boşaltır, çıkar
npm run sidecar        # FastAPI sidecar, http://127.0.0.1:8011
```

**Port notu:** `playwright.config.ts` her zaman `http://localhost:3333`'ü
hedefler ve kendi dev server'ını asla başlatmaz — Next 16 aynı proje dizini
için ikinci bir `next dev`'i tamamen reddediyor ("Another next dev server is
already running"), porttan bağımsız olarak. E2E/Playwright ile çalışacaksan
`npm run dev -- -p 3333` kullan; 3333'te zaten biri çalışıyorsa (ör. founder'ın
kendi oturumu) **öldürme**, olduğu gibi kullan.

**Worker olmadan** yüklenen bir Wave `pending`/`processing` durumunda kalır,
sadece işlenmemiş orijinal dosya çalar — worker çalışınca gerçek zamanda
işlenir (varsayılan 5 sn poll aralığı).

### Telefonda test (aynı Wi-Fi)

Next dev server varsayılan olarak tüm arayüzlere bağlanır (`-H`/`--hostname`
varsayılanı `0.0.0.0`, bu Next 16 CLI'ının kendi belgelenmiş davranışı —
`node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`), yani
`npm run dev` çalışırken bilgisayarının yerel ağ IP'sini bulup
(`ipconfig`/`ifconfig`) telefondan `http://<bilgisayar-ip>:3000` ile
açabilirsin. **Ama** Next geliştirme modunda `localhost` dışından gelen
istekleri varsayılan olarak engeller (dev-only asset/endpoint koruması) —
telefondan LAN IP ile açmak bu yüzden `next.config.ts`'ye
`allowedDevOrigins: ["http://<bilgisayar-ip>:3000"]` eklemeyi gerektirebilir
(bu repoda şu an **yapılandırılmamış** — ilk gerçek cihaz testinde
karşılaşılacak, henüz denenmedi). Mikrofon izni için bazı tarayıcılar HTTPS
isteyebilir — gerçek cihazda ses kaydı testi başarısız olursa localhost
tünelleme (ör. `ngrok`) bir alternatif; bu repo böyle bir araç sağlamıyor.

### Fake mic ile izole Playwright

CLAUDE.md kuralı: paylaşılan MCP tarayıcısı kullanılmaz, her ajan kendi
`chromium.launch()` script'ini yazar:

```ts
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
```

`e2e/duet.spec.ts` gerçek `MediaRecorder`'ı sentetik bir ses akışıyla bu
şekilde test ediyor — fiziksel mikrofon gerekmez.

### `/kit` stil rehberi

`src/app/kit` (route: `/kit`) — tasarım sisteminin yaşayan referansı: tipografi,
renk token'ları, radius ladder, waterline/trace bileşenleri, tüm UI kit
parçaları tek sayfada. Yeni bir bileşen eklerken veya bir renk/spacing
değerinden emin olmadığında önce buraya bak.

---

## (f) Kalite kapıları

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint + scripts/i18n-check.ts (sunucu tarafı string taraması, tolerans yok)
npm run test             # vitest run, tek seferlik
npm run test:watch       # vitest, watch modu
npm run build            # next build + serwist build (service worker üretimi)
npm run e2e               # playwright — backend'e bağlı spec'ler E2E_SUPABASE=1 olmadan hariç tutulur
npm run perf             # build + scripts/perf-budget.ts (route başına gzip JS bütçesi)
npm run verify            # typecheck && lint && test && build sırayla — CI'ın çalıştırdığı tam olarak bu
```

### E2E (canlı backend gerektiren spec'ler)

```bash
E2E_SUPABASE=1 npm run e2e
```

`e2e/auth.spec.ts`, `e2e/duet.spec.ts`, `e2e/critical-journey.spec.ts` gerçek,
göz ardı edilebilir bir Supabase projesi ister (`.env.local`'da 3 anahtar +
`DATABASE_URL`, migration'lar uygulanmış olmalı). PowerShell'de:
`$env:E2E_SUPABASE=1; npm run e2e`.

**Bilinen flake'ler:**
- Aynı anda **sadece bir** `E2E_SUPABASE=1` koşusu — her koşunun
  `globalTeardown`'ı projedeki *tüm* `e2e+*@akinti.(test|example)` hesaplarını
  siliyor, paralel koşu birbirinin hesabını silip sahte "invalid credentials"
  hatası üretir.
- `e2e/auth.spec.ts`'teki gerçek `/signup` formu testi, Supabase'in kendi
  e-posta gönderim kotası dolarsa ("Too many emails requested") ara sıra
  başarısız olur — bu bir altyapı limiti, kod hatası değil, sonra tekrar
  dene.
- `e2e/fixtures/tone.wav` bozulursa/silinirse:
  `ffmpeg -f lavfi -i "sine=frequency=440:duration=3" -ac 1 -ar 44100 e2e/fixtures/tone.wav`.

### `npm run perf` bilinen açık

`docs/qa/full2/REPORT.md` bulgu #5: Wave rotası (`/w/[id]`) 344.0 KB — 340 KB
bütçeyi aşıyor (diğer 4 rota geçiyor). Bu handover anında düzeltilmedi, bkz.
bölüm (j).

### i18n

`npm run lint` içinde otomatik çalışan `scripts/i18n-check.ts`: sunucu tarafı
(`Server Action`/Zod/push/config sabitleri) string'lerinde sıfır tolerans —
yeni bir hardcoded İngilizce string oradaysa lint kırılır. İstemci tarafı
(`.tsx`) için ayrı, ratchet'li bir taramaydı; `fixP2` sırasında baseline
tamamen sıfırlandı (bkz. `docs/I18N.md`) — yeni bir dosyada hardcoded metin
eklemek artık her yerde kırılır, istisna yok.

---

## (g) Mimari harita

```
src/app/**            Rotalar, layout'lar, Server Component/Action'lar (App Router)
src/components/**      Sunum + client bileşenler, UI kit dahil (src/components/ui)
src/lib/audio/**       Kayıt, oynatma, waveform decode — client ses altyapısı
src/lib/db/**          Tipli Supabase sorgu yardımcıları, domain başına bir dosya
src/lib/validation/**  Zod input şemaları
src/lib/auth/**        Auth domain API
src/lib/supabase/**    Supabase client fabrikaları + storage/config sabitleri
src/lib/billing/**     iyzico + Paddle sağlayıcıları, entitlement, webhook mantığı
src/config/**          Marka/terminoloji, tipli route builder'lar
src/proxy.ts           Oturum yenileme + rota koruma matrisi (gerçek yetkilendirme Postgres RLS'te)
src/instrumentation.ts Boot-time env doğrulama
src/types/**           Elle yazılmış Database tipi + uygulama domain tipleri
scripts/worker.ts      Bağımsız ses işleme worker'ı (ffmpeg + sidecar)
scripts/check-env.ts   Env doğrulama, app boot/CLI/Docker'da paylaşılır
supabase/**            Migration'lar, seed, storage/RLS
sidecar/**             Python FastAPI DSP servisi (ayrı süreç, GPL izolasyonu)
e2e/**                 Playwright spec'leri
docs/**                Bu dosya dahil tüm mimari/süreç dokümantasyonu
```

### Tek playback store

Uygulamada **tek** global playback store ve **tek** `<audio>` elementi var
(wavesurfer v7 destekli). Play sayıları her zaman sunucu tarafında sayılır
(`record_play_event()` — client sadece ham oynatmayı raporlar, hangisinin
"sayıldığını" veritabanı belirler).

### Waterline

Tüm görsel sistemin tek çizim ilkesi: ses, ayraç, ilerleme ve geçmiş hepsi
bir "trace" (iz). Kart yok (Explore creator tile tek istisna), gölge/glass/
gradient yok (24px kenar solması hariç). Detay: `docs/design/DESIGN.md`.

### Server Action şekli

Her Server Action `{ ok, fieldErrors?, formError?, message?, data? }` döner,
istemciye asla throw etmez; rate-limit ve moderasyon hataları
`src/lib/moderation/errors.ts` üzerinden eşlenir.

### RLS kuralı

RLS asla bypass edilmez; admin client (service role) sadece bir RLS/RPC
yetkilendirme kontrolünden **sonra** kullanılır. `can_view_wave`,
`can_comment_on_wave`, `can_request_duet`, `is_moderator` vb. (migration 10,
`docs/SECURITY.md`) görünürlük kuralının **tek** yazıldığı yer — hem RLS
policy'leri hem uygulama kodu bunları çağırır, ikinci bir yerde tekrar
yazılmaz.

### Worker/sidecar akışı

1. `finalizeUpload`/publish → `enqueue_audio_job()` RPC → `audio_processing_jobs`
   tablosuna `pending` satır.
2. `scripts/worker.ts` 5 sn'de bir `claim_audio_jobs()` ile iş çeker
   (`FOR UPDATE SKIP LOCKED`, birden fazla worker güvenle paralel çalışabilir).
3. ffmpeg ile temel işleme; gerekirse sidecar'a HTTP ile DSP için gider
   (`/clean`, `/master`, `/pitch-score`, `/pitch-snap`, `/harmony`, `/peaks`)
   — sidecar erişilemezse (pitch_snap/self_harmony hariç) dürüst ffmpeg-only
   fallback'e düşer.
4. `complete_audio_job()`/`fail_audio_job()` RPC ile sonuç yazılır — asla
   sahte "ready" yok.
5. Worker'ın kendi bakım döngüsü ~1 dk'da bir `requeue_stalled_audio_jobs()`
   ve `expire_duet_requests()` çağırır.

### Flow

`get_flow_page()` RPC'siyle beslenen, giriş sonrası varsayılan tam ekran
dinleme akışı (Reels benzeri). Sıra: takip edilenlerden duyulmamışlar →
kendi Duet/Open Call cevapları → canlı challenge girişleri → 48 saatlik
yükselen Wave'ler → her ~8 slotta bir backing-track/Open-Call daveti.
Ayrıntı: `docs/FLOW.md`.

### Duet modları

`waves.duet_mode`: `layer` (katmanlı, varsayılan), `atisma` (dönüşümlü
segment — geleneksel atışma), `cypher` (sıralı, 4 kişiye kadar verse).
Zincir derinliği 6 ile sınırlı. Ayrıntı: `docs/DUET_SPEC.md`.

### Pro

`has_pro(user_id)` (SECURITY DEFINER SQL fonksiyonu) tek entitlement
kaynağı. İki ödeme rayı: iyzico (TRY, Türkiye), Paddle (USD, uluslararası) —
plan kodunun `provider` kolonu yönlendirme kuralının kendisi. Ayrıntı:
`docs/BILLING.md`.

---

## (h) Tasarım kuralları özeti

Tam kural kitabı `CLAUDE.md`'de (özet) ve `docs/design/DESIGN.md`'de (tam,
özellikle **§12 "Never do"** listesi — her yeni ekran bu listeye karşı
kontrol edilmeli). Hangi doküman neyi belirler:

| Doküman | Ne belirler |
|---|---|
| `CLAUDE.md` | Kısa özet kural kitabı, her ajanın önce okuduğu dosya |
| `docs/design/DESIGN.md` | Tam görsel sistem: waterline, tipografi, radius, motion, bileşenler, kopya kuralları, §12 Never Do |
| `docs/design/COLOR_V2.md` | Renk — DESIGN.md §4'ün yerine geçer, çakışırsa bu kazanır (6 Eylül 2026 founder kararı) |
| `docs/design/SCREENS.md` | Ekran ekran layout referansı |
| `docs/design/DESIGN_DNA.json` | Token'ların makine-okunur hali |
| `docs/research/mobile-guidelines.md` | 60 kurallık mobil checklist, her ekran geçmeli |

**Kısa özet:** tek çizim ilkesi waterline (kart yok, Explore creator tile
istisna); gölge/glass/gradient yok (24px kenar solması hariç); **Signal**
rengi (`#DE3C11` açık / `#FF5C33` koyu) **sadece canlı sesle** ilişkili
yerlerde (çalınan iz, kayıt lambası, canlı seviye, duyulmamış işareti,
Duet'e açık işareti) — sekme, takip butonu, link, rozette **asla**; mor/
violet/indigo hiçbir yerde yok; tipografi Archivo Variable (görüntü genişletilmiş
`wdth 112`) + Martian Mono (sadece sayılar); `subsets: ['latin','latin-ext']`
her `next/font/google` çağrısında; radius rol taşır (`0/2/6/10/14/16/24`),
tek radius her yerde asla; motion sese bağlıysa linear, stagger yok; Phosphor
ikon, tek ağırlık; cümle içi büyük harf, ünlem yok, em dash yok; gamification
(streak/rozet/confetti) yok.

**Bilinen ihlal (full2 QA #1):** `/settings/appearance` hâlâ mor/violet
preset ve gradient sunuyor, hiçbir yere bağlı değil — bkz. bölüm (j).

---

## (i) Yayına alma

### Vercel (web app)

Bu repoyu (`app/` — ayrı monorepo kökü yok) içe aktar, Next.js preseti
otomatik algılanır. `next.config.ts`'de zaten yapılandırılmış, **dashboard'da
tekrarlamana gerek yok ama silme**:

- `serverExternalPackages: ["iyzipay"]` — Turbopack'in statik bundle
  edemediği bir `fs.readdirSync` deseni için.
- `outputFileTracingIncludes` — `/api/billing/iyzico/*` ve `/settings/pro`
  için `iyzipay`'in `lib/resources/**` dizinini deploy'a dahil eder (bu
  olmadan Vercel deploy'u eksik dosyayla ilk iyzico çağrısında çöker).
- CSP zaten Paddle (`cdn.paddle.com`, `*.paddle.com`, `buy.paddle.com`) ve
  iyzico (`*.iyzipay.com`) origin'lerini içeriyor — review3 bulgu #2 fixR3'te
  düzeltildi, doğrulaması "Ortam değişkenleri" listesindeki her sağlayıcı
  ile bir sandbox checkout tamamlayarak yapılmalı (bkz. smoke listesi
  aşağıda).
- `experimental.inlineCss: true` — Tailwind stylesheet'i inline eder, LCP
  için (perf3).

**Ortam değişkenleri** (Vercel → Project Settings → Environment Variables,
Production + Preview + Development): bölüm (c)'deki tam liste + tam tablo
`docs/DEPLOYMENT.md`. Kritik: `SUPABASE_SERVICE_ROLE_KEY` **"Expose to
browser" işaretlenmeden** eklenir (server-only default zaten doğru).

Webhook'ları kaydet: iyzico Subscription ürün ayarlarında
`https://<domain>/api/billing/iyzico/webhook`; Paddle Notifications'ta
`https://<domain>/api/billing/paddle/webhook` (en az `subscription.created`/
`updated`/`activated`/`trialing`/`past_due`/`paused`/`canceled`/`resumed`
olaylarına abone).

### Worker + sidecar — bir VPS'te Docker

```bash
docker build -f Dockerfile.worker -t akinti-worker .
docker build -f Dockerfile.sidecar -t akinti-sidecar .
```

İkisi de aynı özel ağda çalışmalı (Fly.io'da aynı app'in iki process'i,
Railway'de aynı proje private networking, veya aynı VPS'te
`docker-compose.worker.yml`). Sidecar'ı **asla public port'a açma** — kendi
auth'u yok, sadece worker'dan gelen HTTP'ye güveniyor. Worker'ı
`SIDECAR_URL=http://<private-host>:8011` ile sidecar'a işaret et. Worker
container'ı `SUPABASE_SERVICE_ROLE_KEY` + diğer iki Supabase değişkenini
ister; entrypoint `check-env:worker`'ı başarısızsa container'ı hemen
durdurur.

`claim_audio_jobs` `FOR UPDATE SKIP LOCKED` kullanıyor, birden fazla worker
instance'ı güvenle paralel koşabilir — ölçeklendirme ihtiyacı
`audio_processing_jobs`'da `pending` sayısı büyüdükçe ikinci bir instance
eklemek.

### Supabase prod ayarları

Bölüm (d)'deki her şey + Realtime zaten migration'larla açık
(`notifications`, `messages`) — panelde ek ayar gerekmiyor. `pg_cron`
isteğe bağlı (worker'ın kendi bakım döngüsü zaten yeterli, sadece worker
sürekli çalışmıyorsa gerekli, bkz. `docs/DEPLOYMENT.md`).

### Anahtar rotasyonu — TAMAMLANDI (2026-09-09)

`docs/HANDOFF.md`'ye göre **`SUPABASE_SERVICE_ROLE_KEY` ve veritabanı şifresi
(`DATABASE_URL`'in parçası) daha önce sohbete/transcript'e yapıştırılmıştı.**
2026-09-09'da founder tarafından rotasyon yapıldı, aynı oturumda canlıya
karşı doğrulandı:

1. Supabase → Project Settings → API → yeni anahtarlar üretildi — bu sırada
   Supabase'in **yeni anahtar sistemine** geçildi: `SUPABASE_SERVICE_ROLE_KEY`
   artık `sb_secret_...`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` artık
   `sb_publishable_...` formatında (eski `eyJ...` JWT formatı değil).
2. Database → **Reset database password** yapıldı, `DATABASE_URL` güncel.
3. Eski (sızmış) legacy JWT tabanlı anon/service_role anahtarları panelden
   **"Disable JWT-based API keys"** ile kalıcı olarak devre dışı bırakıldı —
   geri dönüşü yok.
4. Doğrulama (aynı oturumda, değerler hiç sohbete yazdırılmadan): yeni
   `service_role` ile `npx tsx scripts/verify-live.ts` → 9/9; yeni anon
   (`sb_publishable_`) ile gerçek bir istemci isteği (RLS altında `waves`
   sorgusu + `avatars` bucket listesi) → başarılı; yeni `DATABASE_URL` ile
   `npm run db:migrate` → gerçek bağlantı kuruldu, **57/57 migration zaten
   uygulanmış** (bu, bölüm (d)'deki "teyit edilmeli" notunu da kapatır).
   `@supabase/supabase-js@2.114.0` yeni
   anahtar formatıyla sorunsuz çalışıyor.
5. **Henüz yapılmadı çünkü henüz gerekmiyor**: adım 3/4'teki "Vercel env +
   worker/sidecar host'u güncelle, yeniden deploy et" — proje henüz Vercel'e
   veya bir worker/sidecar sunucusuna deploy edilmedi (bkz. bölüm (j)), tek
   canlı yer bu makinenin `.env.local`'ı. İlk gerçek deploy'da bu adım
   hatırlanmalı.

Tam adımlar (ileride tekrar rotasyon gerekirse): `docs/OPERATIONS.md`
"Rotating keys / secrets", `docs/DEPLOYMENT.md` bölüm 4b — yeni anahtar
formatına göre güncellenmedi, biri güncellemeli.

**Ek bulgu (bu handover sırasında):** `docs/qa/full2/lighthouse/*.json`
dosyalarının 4'ünde de gerçek, canlı bir Supabase oturum çerezi
(`sb-apxdfjfrbrgdykycnoem-auth-token=...`, iki tek kullanımlık e2e test
hesabına ait access/refresh token) ham halde bulundu — bu handover kapsamında
**redakte edildi** (bkz. bölüm (j)). Bu, anahtar rotasyonu gerekliliğini
değiştirmez ama commit etmeden önce her zaman QA çıktısı gibi "zararsız"
görünen dosyaların içeriğini de tara.

### VAPID üretimi (prod)

```bash
npx web-push generate-vapid-keys
```

Public anahtarı hem Vercel'e (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`) hem gerekirse
yerel `.env.local`'a koy, private anahtarı sadece Vercel'e
(`VAPID_PRIVATE_KEY`, server-only). Rotasyon her mevcut push aboneliğini
geçersiz kılar — kendiliğinden temizlenirler (bir sonraki push 404/410
aldığında).

### iyzico / Paddle hesap ve plan seed'i

1. iyzico Merchant Panel → Subscription → Products & Pricing Plans'ta gerçek
   aylık/yıllık planları oluştur; Paddle → Catalog → Prices'ta aynısını.
2. Referans kodlarını/id'leri `.env.local`/Vercel'e:
   `IYZICO_PLAN_MONTHLY_TRY`, `IYZICO_PLAN_YEARLY_TRY`,
   `PADDLE_PRICE_MONTHLY_USD`, `PADDLE_PRICE_YEARLY_USD`. Yıllık planlar
   ayrıca kendi `*_AMOUNT` değerini ister (indirim oranı henüz karara
   bağlanmadı — founder'dan gelmeli).
3. `npm run seed:plans` — idempotent, sadece id'si set edilmiş plan satırını
   ekler, hiçbir zaman uydurma bir fiyatla doldurmaz.

### Yayın sonrası duman testi (smoke checklist)

Tam liste `docs/DEPLOYMENT.md` bölüm 4 — özet: `/explore` 200 + güvenlik
başlıkları var; gerçek e-posta ile signup → onboarding; kayıt/yükleme →
publish → worker işliyor → oynatılabiliyor; ikinci bir gizli sekmede
görünürlük kuralı doğru; Duet isteği → kabul → bildirim gerçek zamanlı;
`/settings/pro` gerçek fiyat gösteriyor (seed:plans doğru çalıştıysa); her
sağlayıcıdan bir gerçek (sandbox/test kart) checkout tamamla, webhook'un
`billing_events`'e düştüğünü ve `has_pro()`'nun değiştiğini doğrula; sidecar
varsa `/health`'te `librosa: true` + `pitch_score: true`; VAPID
ayarlıysa gerçek bir OS push bildirimi gelsin.

---

## (j) Açık işler ve öncelik sırası

En son bağımsız QA turu: `docs/qa/full2/REPORT.md` (7/10, 2026-09-06). Önceki
tur: `docs/qa/review3/REVIEW.md` (kod/güvenlik incelemesi, 5/10) — o turun
5 P0'ı `fixR3` ajanı tarafından düzeltildi (`docs/HANDOFF.md`'de commit
hash'leriyle). Kalanlar, öncelik sırasıyla:

### P1 (full2, launch öncesi düzeltilmeli)

1. ~~**`/settings/appearance`** — mor/violet ve plum preset'leri...~~ **ZATEN
   ÇÖZÜLDÜ, bu doküman güncellenmeden önce** — `0ead4c4`
   (`feat(appearance): replace inert theme presets with theme mode +
   signature hue`), bu HANDOVER.md'nin yazıldığı `7f05131`'den önceki bir
   commit. Preset sistemi (`ACCENT_PRESETS`/`BACKGROUND_PRESETS`/
   `GRADIENT_PRESETS`) tamamen kaldırıldı; `AppearanceForm.tsx` artık sadece
   tema modu + COLOR_V2'nin 4 sabit imza tonundan biri sunuyor, kart/gradient
   yok. 2026-09-09 oturumunda kod + testler (`profileTheme.test.ts`,
   `designTokens.test.ts`, 27/27) yeniden doğrulandı — bu madde
   düzeltilirken bu doküman güncellenmemiş, bir sonraki tarama bunu tekrar
   açık sanmasın diye burada not edildi.
2. ~~**Pro/TRY checkout sırası**~~ **ZATEN ÇÖZÜLDÜ** — `79a8025`
   (`fix(billing): gate TRY checkout on plan + provider readiness`), da
   `7f05131`'den önce. `isIyzicoConfigured()` + TRY plan var mı kontrolü artık
   buyer-details Sheet'i açmadan önce çalışıyor; hatalar `SettingsProActions.*`
   üzerinden tam Türkçe. 2026-09-09'da kod okunarak doğrulandı.
3. ~~**Challenges içeriği çevrilmemiş**~~ **ZATEN ÇÖZÜLDÜ** — `60e2e67`
   (`feat(challenges): bilingual title/brief...`), migration
   `20260906220100_challenge_locale.sql` (`title_tr`/`brief_tr`) canlıda,
   `scripts/seed-challenges.ts` hand-written TR içerik yazıyor. 2026-09-09'da
   şema + seed script okunarak doğrulandı.
4. ~~**Flow/Explore performansı**~~ **ÇÖZÜLDÜ.** full2'nin bulduğu Flow
   2100ms/Explore 1330ms TBT için `f9d03a4` (`ShareSheet` `next/dynamic`)
   zaten uygulanmıştı (yine `7f05131`'den önce) ama kendi raporu
   (`docs/qa/fixQA2/TBT.md`) host gürültüsü yüzünden sonucu kanıtlanmış
   saymıyordu. 2026-09-09'da sessiz bir host'ta yeniden ölçüldü
   (`docs/qa/tbt2/TBT.md`): Flow medyan TBT 203ms (10x iyileşme, 3/3 run
   tutarlı) → çözülmüş sayıldı. Explore medyan TBT 523ms (2.5x iyileşme) ama
   1 run'da 1602ms'e sıçradı, kararsız sayılmıştı. **2026-09-13'te Explore
   için 3 run daha koşuldu** (`docs/qa/tbt3/TBT.md`, kod değişmeden): 682/
   524/476ms — hiçbiri 1602ms'i tekrarlamadı, toplam 6 run'ın 5'i <1000ms.
   Tek bir sıçrama host/scheduler gürültüsüne uyuyor, tekrarlayan bir
   regresyon değil (kapatma eşiği: 2+ run >1000ms — karşılanmadı). **Sonuç:
   Flow ve Explore ikisi de çözülmüş sayılıyor**, medyan ~500-600ms
   ("needs improvement" bandı, "poor" değil) — daha fazla TBT işi
   planlanmıyor.

### P2 (öncelik sırasıyla, launch sonrası ilk tur)

- `npm run perf`: Wave rotası 344 KB, bütçe 340 KB (küçük ama gerçek aşım).
- Flow'da axe `aria-hidden-focus` (serious): virtualize edilen pasif Wave
  panelinde `aria-hidden` var ama içindeki kontroller `tabIndex={-1}`/`inert`
  ile devre dışı bırakılmamış (`src/components/flow/FlowScreen.tsx`).
- `/create` Details adımında tür etiketleri (Music/Talk/Storytelling/…)
  hâlâ İngilizce (bilinen, dokümante edilmiş borç — `docs/I18N.md` §4).
  Bazıları full2 sonrası düzeltilmiş olabilir, `src/config/terminology.ts`'i
  kontrol et.
- Bir React #418 hydration hatası (TR mobil oturumda tek sefer görüldü,
  tetikleyen ekran full2'de izole edilmedi).
- 15+ dosyada hâlâ `rounded-xl border border-border bg-surface` "kart"
  deseni (DESIGN.md §12 kural 1 ihlali) — Settings/Profile/Analytics alt
  sayfaları.

### review3'ten kalan, henüz teyit edilmemiş maddeler

- **iyzico Resume desteği yok** (`BillingProviderClient.resume()`) —
  sağlayıcının kendi API'sinde dürüst bir karşılığı yok, `IyzicoProvider.resume()`
  bilinçli olarak hata döndürüyor; bu bir eksik değil, belgelenmiş bir
  sağlayıcı kısıtı — kullanıcıya "yeni abonelik başlat" seçeneği zaten
  sunuluyor.
- **iyzico/Paddle sandbox ödeme testi** hiç uçtan uca tamamlanmadı (gerçek
  sandbox anahtarları hiç girilmedi bu ortamda).
- **Gerçek cihazda Flow/Duet dinleme testi** yapılmadı — review3 bulgu #5
  (Web Audio `crossOrigin` eksikliği, Flow'un sessiz çalması) fixR3'te
  kod seviyesinde düzeltildi ama kulakla doğrulanmadı; `docs/qa/flow/`'da
  19/20 Playwright kontrolü geçti ama hiçbiri sesin duyulduğunu iddia
  etmiyor — review3'ün kendi notu: "confirm by ear, not by screenshot."
- `akinti.app` alan adı henüz bağlanmadı/satın alınmadı — **doğrulanmadı**,
  founder'la teyit et.
- **(app) route grubunun tüm mesaj bundle'ının küçültülmesi** —
  `docs/HANDOFF.md`'de birkaç kez "sıradaki" olarak listelenmiş, tamamlandığı
  teyit edilmedi.
- İki throwaway e2e test hesabı (`e2e+f2a-*@akinti.test`,
  `e2e+f2b-*@akinti.test`) full2 QA turundan kalmış olabilir — canlı
  projede hâlâ varsa temizle (Supabase Auth panelinden veya
  `deleteAccount` akışıyla).

---

## (k) Claude Code ile devam edilecekse

Bu proje Claude Code + çoklu ajan (Fable orkestrasyon) ile geliştirildi.
Devam etmek istersen:

- **`CLAUDE.md`'yi oku** — kısa, komut odaklı kural kitabı; her ajan işe
  başlamadan bunu okumalı. Kaynak dokümanların hangisinin neyi belirlediği
  orada listeli (bölüm (h)'de özetlendi).
- **Ajan disiplini** (`CLAUDE.md` "Multi-agent discipline"):
  - Yönetici ajan (varsa) kod yazmaz, sadece ajanları yönetir.
  - Her ajana **açık dosya sahipliği** ver — eşzamanlı çalışan başka bir
    ajanın dosyasını asla düzenleme, gerekiyorsa değişikliği rapor et.
  - Commit ederken **her zaman açık yol** kullan: `git add <path1> <path2>`
    — asla `git add -A`/`git add .`. Bu projede birkaç kez ajanların
    `-A` kullanması yüzünden dosyalar birbirine karıştı (`docs/HANDOFF.md`'de
    not edilmiş).
  - `.env.local`, `.omc/`, `docs/` dışındaki ekran görüntüleri asla commit
    edilmez.
  - UI işi yapan her ajan **kendi izole** `chromium.launch()` script'ini
    kullanır, paylaşılan MCP tarayıcısını kullanmaz.
  - Commit mesajı formatı: `tip(kapsam): açıklama`, trailer
    `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **`docs/HANDOFF.md`'yi güncel tut** — bu proje boyunca her ajan turunun
  sonunda oraya kısa bir özet (ne değişti, hangi commit, ne açık kaldı)
  eklendi. Yeni bir oturuma başlarken önce `git status`, sonra bu dosyanın
  en üst/en son bölümü okunuyor — tüm geçmişi her seferinde yeniden okumak
  yerine.
- **Doğrulama önce** — `npm run typecheck && npm run lint && npm run test
  && npm run build` yeşil olmadan hiçbir iş "bitti" sayılmıyor; UI işi için
  ayrıca izole Playwright + ekran görüntüleri `docs/qa/<tur-adı>/` altına.

---

## (l) Sözlük

| Terim | Anlamı |
|---|---|
| **Wave** | Paylaşılan ses nesnesi (kayıt veya yükleme) — ürünün temel sosyal birimi |
| **Duet** | Bir Wave'e karşı eşzamansız, işbirlikli cevap kaydı |
| **Open Call** | Bir Wave sahibinin "herkes Duet yapabilir" davetini açması — istek/kabul turunu atlar |
| **Atışma** | Duet modu: dönüşümlü, karşılıklı segmentlerden oluşan geleneksel atışma tarzı |
| **Cypher** | Duet modu: sıralı, en fazla 4 kişilik verse zinciri |
| **Layer** | Duet modu: katmanlı (varsayılan), orijinalin üzerine kayıt |
| **Flow** | Giriş sonrası varsayılan, tam ekran, sürekli oynatan dinleme akışı (`get_flow_page()`) |
| **Signal** | Sadece canlı sesle ilişkilendirilen tek renk (`#DE3C11`/`#FF5C33`) — çalınan iz, kayıt lambası, canlı seviye, duyulmamış/Duet'e açık işareti |
| **waterline** | Tüm görsel sistemin tek çizim ilkesi — ses izi, ayraç, ilerleme, geçmiş hepsi aynı çizgi motifiyle gösterilir |
| **Pro** | AKINTI Pro abonelik katmanı: pitch snap + self-harmony + stems, sınırsız kaydetme, reklamsız, aylık bir öne çıkan Duet slotu, Pro rozeti |
