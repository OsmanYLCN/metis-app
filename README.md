# Metis

**M0 / Foundation — Dilim 05, v0.5.0.** Windows masaüstü için Tauri 2 + React + TypeScript + Vite; ASP.NET Core 10 API, yerel SQLite, Supabase JWT doğrulaması ve geçici masaüstü giriş akışı. Ürünün yeni adı Metis. Varsayılan sağlayıcı kapalıdır; kullanıcının gerçek proje ayarları bu dilimde boş bırakıldı. Tam ürün veya tamamlanmış M0 değildir.

## Bu dilimde çalışanlar

- Minimal Türkçe uygulama kabuğu, 12 modül için gezinme, açık/koyu/sistem teması.
- Dashboard temel durum ekranı; diğer modüller açıkça işaretli boş ekranlardır.
- Gerçek yerel API üzerinden bağlantı kontrolü, 4 saniye zaman aşımı ve yeniden deneme.
- `GET /health`: API sürecinin canlılık kontrolü. Veritabanı veya sync hazırlığını ölçmez.
- Monorepo, mimari karar kaydı, gerçek API smoke testleri ve arayüz kontrolleri.
- Gerçek yerel SQLite dosyası; atomik ilk migration, migration günlüğü ve yeniden açılışta korunan temel kayıt.
- Yerel depolama durum kartı; tarayıcıda desteklenmediğini, masaüstünde başarı/hata durumunu açıkça gösterir.
- Hesap/oturum sözleşmesi, başlangıçta doğrulanan sağlayıcı ayarları ve gerçek API'den okunan hesap durum kartı.
- Supabase yapılandırıldığında public JWKS ile gerçek sunucu token doğrulaması.
- Mevcut Auth kullanıcısı için e-posta/parola giriş formu, API tarafından doğrulanan oturum, cihazdan çıkış, iptal/hata ve süre sonu yönetimi. Oturum yalnızca bellekte tutulur; kalıcı saklama ve yenileme yoktur.

**Demo sınırı:** İş modülleri yerel önizlemedir; gerçek kayıt içermez. Health ve masaüstündeki SQLite mock değildir. SQLite yalnızca rastgele depolama kimliğini, oluşturulma zamanını ve migration geçmişini saklar. Giriş kodu gerçek sağlayıcı için hazırdır ancak canlı hesapla denenmedi; otomatik giriş testlerinde sağlayıcı yanıtları mock'tur. PostgreSQL veri bağlantısı, R2 ve hosting yoktur. Tema tercihi sadece oturumda tutulur. Tarayıcıda SQLite yerine sahte başarı gösterilmez. Tarayıcı önizlemesi ayrı web ürünü değildir.

## Hazır Windows uygulaması

`outputs/Metis-M0.5.exe` public bağlantı ayarları boşken üretilen Windows önizlemesidir. **SQLite için API'yi veya interneti açmak gerekmez.** API kapalıysa bağlantı ve hesap kartlarının erişilemiyor, yerel alan kartının hazır görünmesi beklenen durumdur. API EXE içine paketlenmez; ayrı çalıştırılır. Canlı giriş için yerel ayarları doldurup masaüstünü yeniden başlat/derle: [bağlantı rehberi](docs/supabase-local-setup.md). Güncel kapsam ve sonuçlar: [M0.5 doğrulama kaydı](docs/verification-m0.5.md).

Veritabanı varsayılan olarak `%LOCALAPPDATA%/com.personalos.desktop/storage/personal-os.sqlite3` konumundadır. SQLite Windows'un `winsqlite3.dll` bileşenini kullanır; ayrıca servis veya SQLite kurulumu gerektirmez. Dosya bu dilimde şifrelenmez ve hassas veri içermez. Hata halinde otomatik sıfırlanmaz. Geliştirme/test için yalnızca süreç ortamında `PERSONAL_OS_DATA_DIR` mutlak dizin seçeneği kullanılabilir; normal kullanımda gerekmez.

## Yerel geliştirme (Windows / PowerShell)

Önkoşullar: Node.js 22.12+ (bu çalışmada 24.16.0), .NET SDK 10.0.300+ (`global.json`, 10.0.x feature roll-forward). Native masaüstü için ayrıca Rust MSVC, Visual Studio C++ masaüstü araçları / Windows SDK ve Edge WebView2 gerekir. [Tauri'nin resmi Windows kurulum rehberi](https://v2.tauri.app/start/prerequisites/) bu araçları açıklar.

Repo kökünde:

```powershell
npm.cmd ci
dotnet restore PersonalOS.slnx --locked-mode
npm.cmd run build:api
```

Bir terminalde API:

```powershell
npm.cmd run dev:api
```

İkinci terminalde masaüstü:

```powershell
npm.cmd run desktop
```

Rust kurulumu henüz hazır değilse aynı React kabuğunun tarayıcı önizlemesi:

```powershell
npm.cmd run dev
# http://127.0.0.1:1420
```

İşlem bittiğinde her terminalde `Ctrl+C`. API uygulamayla otomatik paketlenmez/başlatılmaz; bu dilimde ayrı yerel geliştirme sürecidir.

Rust araçları proje kökündeki `work/rust` dizininde bulunuyorsa, aynı PowerShell oturumunda önce:

```powershell
. ./scripts/use-workspace-rust.ps1
npm.cmd run desktop
```

Bu yardımcı proje kökündeki `work/rust` araçlarını kullanır; sistem PATH'ini kalıcı değiştirmez.

Giriş için `apps/desktop/.env.example` dosyasını `.env.local` olarak kopyalayıp yalnızca public Project URL ve `sb_publishable_` değerini yaz. `dev:api` açık bir Identity ortam override'ı yoksa aynı adresten issuer türetir; `desktop`/`build:desktop` yalnızca seçilen proje host'unu Tauri CSP'ye ekler. Parola/secret key dosyaya veya sohbete yazılmaz. Ayrıntılı adımlar [bağlantı rehberinde](docs/supabase-local-setup.md).

## Doğrulama

```powershell
npm.cmd run build           # TypeScript + Vite üretim çıktısı
npm.cmd test                # health, storage bridge ve hesap durumu testleri
npm.cmd run build:api       # .NET Release, uyarılar hata sayılır
npm.cmd run test:api        # ayrı geçici portta gerçek API smoke testleri
npm.cmd run test:ui         # yüklü Microsoft Edge ile arayüz + gerçek API
npm.cmd run test:login-ui   # yalnızca yeni giriş UI'ı; tüm sağlayıcı/API yanıtları mock
npm.cmd run build:desktop   # Rust hazırsa Windows .exe, installer yok
npm.cmd run test:native     # Windows .exe + gerçek API, kısa süreli WebView2 kontrolü
# Rust PATH'te değilse önce: . ./scripts/use-workspace-rust.ps1
npm.cmd run test:storage    # Gerçek disk dosyaları, migration ve ayrı süreçte yeniden açılış
npm.cmd run test:identity   # TestServer + gerçek JWT doğrulama; test JWKS, port/hesap gerektirmez
dotnet build PersonalOS.slnx --configuration Release -m:1
```

UI testi başlamadan 1420 ve 5080 portlarındaki kendi geliştirme süreçlerini durdur. Testler sunucuları kendileri açıp kapatır. `test:api` için önce API derlenmiş olmalıdır. `test:native` için API ve Windows Release derlemeleri hazır olmalı, 5080 portu boş olmalıdır. Native test yalnızca kendi WebView2 sürecine geçici yerel debug portu açar; izole test veritabanını iki ayrı uygulama sürecinde açıp karşılaştırır. Test bitince API ve uygulamayı kapatır; gerçek kullanıcı DB'sini kullanmaz. UI testlerinde ağ kesintisi ve yerel köprü hata/yeniden deneme senaryoları mock'tur; Rust depolama testleri gerçek SQLite dosyaları kullanır. Test sonuçları: [M0.2](docs/verification-m0.2.md), [önceki M0.1](docs/verification.md).

API: `http://127.0.0.1:5080/health`

```json
{"status":"Healthy","service":"personal-os-api","scope":"process-only"}
```

Hesap durumu: `GET /api/v1/auth/status` → `notConfigured`, `provider: null`, `signInAvailable: false`, `sessionPersistence: "none"`.
Oturum: `GET /api/v1/auth/session` → eksik/geçersiz token veya Disabled sağlayıcı için HTTP 401, `authenticated: false`, `state: "signedOut"`, `user: null`. Supabase yapılandırıldığında geçerli kullanıcı Bearer tokenı için HTTP 200, `authenticated: true`, `state: "signedIn"` ve doğrulanmış kullanıcı ID'si döner. Token veya cookie saklanmaz.

Varsayılan `Identity:Provider=Disabled`; bağlantısız kullanım için hesap gerekmez. Backend'de `Identity__Provider=Supabase` ve geçerli `Identity__Authority` ayarlanırsa durum `verificationConfigured` olur; public `issuer` yanıtlanır. Bu, canlı bağlantı kontrolü değildir. API kendi giriş başlatma endpoint'ini sunmadığından `signInAvailable=false` kalır; masaüstü formu eşleşen public proje ayarıyla doğrudan sağlayıcıya bağlanır. ES256/RS256 kullanıcı tokenları doğrulanır; legacy HS256 ve anonim oturumlar reddedilir. Backend key istemez, masaüstü sadece publishable key kullanır. [ADR-0004](docs/adr/0004-supabase-token-verification.md), [ADR-0005](docs/adr/0005-metis-desktop-sign-in.md).

Varsayılan API ve Vite yalnızca loopback dinler. Geliştirme CORS listesi bilinen yerel Vite/preview ve Windows Tauri origin'leriyle sınırlıdır; production ortamında açılmaz. `http://127.0.0.1` yalnızca bu yerel temel içindir. Sonraki uzaktan bağlantı dilimi HTTPS, sunucu tarafı yetkilendirme ve ortama özel CSP/CORS tasarımı gerektirir. Mevcut CORS politikası kimlik doğrulama değildir. [ASP.NET Core health check açıklaması](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks?view=aspnetcore-10.0).

## Yapı

```text
apps/desktop/
  src/                 React kabuğu, health/storage/hesap istemcileri
  src-tauri/           Windows pencere host'u, Rust ve CSP yapılandırması
    src/storage/       SQLite adaptörü, migration runner ve Rust testleri
    migrations/        Sürümlü SQL dosyaları
services/api/          ASP.NET Core 10, health ve yerel geliştirme ayarları
  Modules/Identity/    Sağlayıcı ayarları, JWT doğrulaması ve oturum endpoint'leri
scripts/              Gerçek API smoke testi ve yerel Rust yardımcısı
tests/ui/             Uçtan uca arayüz kontrolleri
tests/login-ui/       Hesap kullanmadan giriş/çıkış UI kontrolleri
tests/api/            TestServer ile hesap ve JWT doğrulama kontrolleri
docs/                 ADR, dilim sınırı, doğrulama ve ekran görüntüleri
```

JavaScript bağımlılıkları npm workspaces ile yönetilir; `package-lock.json` tekrarlanabilir kurulum içindir. Rust bağımlılıkları `Cargo.lock` ile sabitlenir. Yalnızca yerel `main` pencereye `local_storage_status` uygulama komutu izni verilir. Genel dosya, shell, SQL, bildirim veya uzak IPC erişimi açılmaz. Windows SQLite motor sürümü işletim sistemi güncellemelerine bağlıdır; Cargo kilidi bu DLL sürümünü sabitlemez. Installer, imzalama ve auto-update bu dilimin parçası değildir.

## Sonraki küçük dilim

Öneri: **M0.6 — gerçek hesapla bağlantı kontrolü ve güvenli cihaz oturumunun ilk dilimi**. Kalıcı token saklama/yenileme kontrollü olarak ele alınacak; görev CRUD'ı ve sync ayrı dilimlerdir. Başlamak için kullanıcının yeni “devam edelim” onayı gerekir. M0.5'te kullanıcı tercihiyle canlı proje ayarları doldurulmadı.

Ürün planı [ADR-0001](docs/adr/0001-foundation.md), yerel depolama kararları [ADR-0002](docs/adr/0002-local-sqlite.md) içinde. Yeni hosting veya ücretli servis açılmadı. Gizli anahtarları sohbete veya `VITE_*` değişkenlerine koyma; yalnızca publishable key istemci yapılandırmasına uygundur. `.env.local`, yerel DB ve derleme çıktıları Git dışında tutulur. Marka değişirken mevcut uygulama/veri kimliği ve iç paket adları korunmuştur.

## Proje konumu

Proje kökü: C:\Users\Osman\Desktop\Projects\personal-os

Kaynaklar kökte, sürüm dosyaları outputs/, yerel Rust ve .NET geliştirme araçları work/ altındadır.
