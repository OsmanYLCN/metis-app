# Metis

**M0 / Foundation — Dilim 22; masaüstü v0.14.0.** Windows masaüstü için Tauri 2 + React + TypeScript + Vite; ASP.NET Core 10 API, yerel SQLite, Supabase JWT doğrulaması ve masaüstü giriş akışı. Ürünün adı Metis. Repoda varsayılan sağlayıcı kapalıdır; bu çalışma ortamında public Supabase Auth ile ayrı reader/writer bağlantıları yerel, Git dışı ayarlarda yapılandırıldı. Tam ürün veya tamamlanmış M0 değildir.

M0.7: Windows için seçime bağlı şifreli oturum saklama, geri yükleme ve token yenileme etkin. Varsayılan giriş bellek oturumudur. [ADR-0007](docs/adr/0007-remembered-session.md), [doğrulama](docs/verification-m0.7.md).

Görünüm güncellemesi (2026-11-07): koyu temada antrasit/nötr gri palet ve Segoe UI Variable yazı tipi. [Renkler ve görünüm doğrulaması](docs/theme.md).

M0.8: Hesaba göre ayrılan gerçek yerel görev oluşturma, listeleme, tamamlama ve yeniden açma. [ADR-0008](docs/adr/0008-local-tasks.md), [doğrulama ve kullanım](docs/verification-m0.8.md).

M0.9: Görev başlığını düzenleme, iptal/klavye odağı ve görev adıyla kalıcı silme onayı. [Doğrulama ve kullanım](docs/verification-m0.9.md).

M0.10: Merkezi görev veri modeli, doğrulanmış hesaba göre salt okunur API sözleşmesi ve PostgreSQL RLS hazırlığı. Gerçek merkezi bağlantı henüz yoktur; API bu durumda 503 döner. [ADR-0009](docs/adr/0009-central-task-foundation.md), [doğrulama](docs/verification-m0.10.md).

M0.11: Npgsql PostgreSQL okuma adaptörü, sınırlı bağlantı rolü ve gerçek okuma hazırlığı kontrolü. Yerel testler ve canlı Supabase bağlantısı VerifyFull TLS ile doğrulandı; üretim adaptörünün sentetik hesapla okuma kontrolü geçti. Gerçek kullanıcı oturumuyla okuma kontrolü kullanıcı tarafından doğrulandı. [ADR-0010](docs/adr/0010-postgres-task-reader.md), [kurulum](docs/central-postgres-setup.md), [doğrulama](docs/verification-m0.11.md).

M0.12: Genel bakışta açık oturumla **Bulut okumasını kontrol et** düğmesi. Salt okuma ve boş alan/hata açıklamaları hazır; canlı kullanıcı sonucu doğrulandı. [Kullanım ve testler](docs/verification-m0.12.md).

M0.13: Merkezi oluşturma/başlık düzenleme için tekrar gönderme ve revision çatışması karar katmanı. Kalıcı yazma ve sync henüz açık değil; masaüstü EXE aynı kaldı. [ADR-0011](docs/adr/0011-central-write-rules.md), [doğrulama](docs/verification-m0.13.md).

M0.14: Ayrı ve sınırlı PostgreSQL writer rolü, atomik işlem günlüğü ve create/rename adaptörü izole PostgreSQL motorunda doğrulandı. Canlı migration ve HTTP yazma uçları henüz açık değil; masaüstü EXE aynı kaldı. [ADR-0011](docs/adr/0011-central-write-rules.md), [doğrulama](docs/verification-m0.14.md).

M0.15: Writer için reader'dan ayrı güvenli yapılandırma ve doğrulanmış kullanıcıya bağlı create/rename HTTP uçları hazır. Canlı migration ve writer parolası henüz uygulanmadı; masaüstü bu uçları çağırmıyor. [Kurulum rehberi](docs/central-writer-setup.md), [doğrulama](docs/verification-m0.15.md).

M0.16: Canlı writer kurulumu tamamlandı. Masaüstündeki açık kullanıcı eylemiyle tek sentetik create/replay/rename ve son okuma doğrulandı; normal görevler yüklenmedi ve sync açılmadı. [Canlı kurulum](docs/central-writer-setup.md), [doğrulama](docs/verification-m0.16.md).

## Bu dilimde çalışanlar

- Minimal Türkçe uygulama kabuğu, 12 modül için gezinme, açık/koyu/sistem teması.
- Dashboard temel durum ekranı ve Windows için gerçek yerel görev listesi; diğer modüller açıkça işaretli boş ekranlardır.
- Gerçek yerel API üzerinden bağlantı kontrolü, 4 saniye zaman aşımı ve yeniden deneme.
- `GET /health`: API sürecinin canlılık kontrolü. Veritabanı veya sync hazırlığını ölçmez.
- Monorepo, mimari karar kaydı, gerçek API smoke testleri ve arayüz kontrolleri.
- Gerçek yerel SQLite dosyası; atomik ilk migration, migration günlüğü ve yeniden açılışta korunan temel kayıt.
- Yerel depolama durum kartı; tarayıcıda desteklenmediğini, masaüstünde başarı/hata durumunu açıkça gösterir.
- Hesap/oturum sözleşmesi, başlangıçta doğrulanan sağlayıcı ayarları ve gerçek API'den okunan hesap durum kartı.
- Supabase yapılandırıldığında public JWKS ile gerçek sunucu token doğrulaması.
- Mevcut Auth kullanıcısı için e-posta/parola giriş formu, API tarafından doğrulanan oturum, cihazdan çıkış, iptal/hata ve süre sonu yönetimi. Varsayılan oturum bellektedir; hatırla seçilirse refresh token şifreli kasaya yazılır ve yenilenir.

**Kapsam sınırı:** Görevler Windows uygulamasında gerçek yerel kayıtlardır; diğer iş modülleri yerel önizlemedir. Health ve masaüstündeki SQLite mock değildir. SQLite şema sürümü 4'tür. Kullanıcı canlı girişi, oturum geri yüklemeyi ve kontrollü sentetik writer kontrolünü başarılı bildirdi; otomatik testlerde sağlayıcı yanıtları mock kullanılır. Seçilen yerel görev ve başlık değişikliği açık kullanıcı eylemiyle buluta gönderilebilir. Otomatik veya çift yönlü eşitleme, bulut tamamlama/silme, R2 ve hosting henüz yoktur. Tema tercihi sadece oturumda tutulur. Tarayıcı önizlemesi ayrı web ürünü değildir.

## Hazır Windows uygulaması

Güncel **outputs/Metis-M0.22.exe** gönderilmiş görev durumunu ve açık kullanıcı eylemiyle güvenli başlık güncellemesini içerir. [M0.22 doğrulama](docs/verification-m0.22.md). SQLite şema 4 korunur. Eski sürümden geçerken önce bütün Metis pencerelerini kapat. Önceki teslim notları aşağıda tarihsel kayıt olarak durur.

Önceki teslim **outputs/Metis-M0.19.exe**: yerel kuyruk uzlaştırması ve görev ekranında bekleyen kayıt sayısı. [M0.19 kaydı](docs/verification-m0.19.md). Bu sürüm SQLite şema 3'e yükseltti; M0.16 aynı veritabanını açamaz.

`outputs/Metis-M0.16.exe` önceki Windows teslimidir. **Yerel depolama ağ gerektirmez; görev ekranına ilk giriş, oturum geri yükleme ve açıkça başlatılan bulut kontrolü için API/Supabase bağlantısı gerekir.** API EXE içine paketlenmez; ayrı çalıştırılır. O sürümün kapsamı: [M0.16 doğrulama kaydı](docs/verification-m0.16.md).

Veritabanı varsayılan olarak `%LOCALAPPDATA%/com.personalos.desktop/storage/personal-os.sqlite3` konumundadır. SQLite Windows'un `winsqlite3.dll` bileşenini kullanır; ayrıca servis veya SQLite kurulumu gerektirmez. SQLite dosyası şifrelenmez; kullanıcının yazdığı görev başlıklarını içerir. Hesaba göre liste ayrımı aynı Windows kullanıcısına karşı bir güvenlik sınırı değildir. Hata halinde otomatik sıfırlanmaz. Geliştirme/test için yalnızca süreç ortamında `PERSONAL_OS_DATA_DIR` mutlak dizin seçeneği kullanılabilir; normal kullanımda gerekmez.

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
npm.cmd run test:tasks-schema # yerel PostgreSQL motorunda şema ve RLS; canlı bağlantı yok
npm.cmd run test:postgres   # Npgsql TCP + izole PostgreSQL motoru; gerçek hesap/parola yok
npm.cmd run test:postgres-writer # Atomik create/rename + işlem günlüğü; yalnızca izole test DB
npm.cmd run test:ui         # yüklü Microsoft Edge ile arayüz + gerçek API
npm.cmd run test:login-ui   # giriş ve görev UI; sağlayıcı/API/IPC yanıtları mock
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

Varsayılan `Identity:Provider=Disabled`; kabuğu ve depolama durumunu görmek için hesap gerekmez. Görev ekranı doğrulanmış açık oturum ister. Backend'de `Identity__Provider=Supabase` ve geçerli `Identity__Authority` ayarlanırsa durum `verificationConfigured` olur; public `issuer` yanıtlanır. Bu, canlı bağlantı kontrolü değildir. API kendi giriş başlatma endpoint'ini sunmadığından `signInAvailable=false` kalır; masaüstü formu eşleşen public proje ayarıyla doğrudan sağlayıcıya bağlanır. ES256/RS256 kullanıcı tokenları doğrulanır; legacy HS256 ve anonim oturumlar reddedilir. Backend key istemez, masaüstü sadece publishable key kullanır. [ADR-0004](docs/adr/0004-supabase-token-verification.md), [ADR-0005](docs/adr/0005-metis-desktop-sign-in.md).

Varsayılan API ve Vite yalnızca loopback dinler. Geliştirme CORS listesi bilinen yerel Vite/preview ve Windows Tauri origin'leriyle sınırlıdır; production ortamında açılmaz. `http://127.0.0.1` yalnızca bu yerel temel içindir. Sonraki uzaktan bağlantı dilimi HTTPS, sunucu tarafı yetkilendirme ve ortama özel CSP/CORS tasarımı gerektirir. Mevcut CORS politikası kimlik doğrulama değildir. [ASP.NET Core health check açıklaması](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks?view=aspnetcore-10.0).

## Yapı

```text
apps/desktop/
  src/                 React kabuğu, health/storage/hesap ve yerel görev istemcileri
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

JavaScript bağımlılıkları npm workspaces ile yönetilir; `package-lock.json` tekrarlanabilir kurulum içindir. Rust bağımlılıkları `Cargo.lock` ile sabitlenir. Yalnızca yerel `main` pencereye depolama durum, oturum kasası ve beş dar kapsamlı görev komutu izni verilir. Genel dosya, shell, SQL, bildirim veya uzak IPC erişimi açılmaz. Windows SQLite motor sürümü işletim sistemi güncellemelerine bağlıdır; Cargo kilidi bu DLL sürümünü sabitlemez. Installer, imzalama ve auto-update bu dilimin parçası değildir.

## Sonraki küçük dilim

M0.20 kaynak kodunda kalıcı gönderim niyeti ve receipt doğrulaması hazır. [Doğrulama](docs/verification-m0.20.md). Sonraki birleşik adım tek görev için açık kullanıcı eylemiyle HTTP gönderim ve yerel onay bağlantısıdır. M0.19 son teslim EXE'sidir; aşağıdaki aşama notları tarihseldir.

M0.18 kaynak kodunda hesap kapsamlı kuyruk okuma ve yeni görev/create kaydının atomik yazılması birlikte tamamlandı. [Kapsam ve sınırlar](docs/verification-m0.18.md). Sonraki dilim yerel değişikliklerin kuyrukla uzlaştırılması ve durum arayüzüdür; aşağıdaki M0.17 notu tarihsel aşamadır.

M0.17: Yerel outbox şema temeli kaynak kodda hazır; SQLite şema 3'e veri koruyan geçiş, değişmez işlem içeriği ve kalıcı operation kimliği testleri eklendi. Henüz görev komutlarına bağlanmadı; yeni EXE yayımlanmadı. [Kapsam](docs/verification-m0.17.md). Sonraki adım hesap kapsamlı yerel kuyruk erişimi ve atomik kayıt katmanıdır.

Canlı reader/writer bağlantısı ve kullanıcı tarafından başlatılan tek create/replay/rename kontrolü doğrulandı. Sonraki aday küçük dilim, normal görev akışına dokunmadan kalıcı yerel outbox/operation kimliği temelidir. Otomatik yükleme, çift yönlü sync ve diğer modüller ayrı dilimlerde kalır. Yeni kullanıcı onayı olmadan devam edilmez.

Ürün planı [ADR-0001](docs/adr/0001-foundation.md), yerel depolama kararları [ADR-0002](docs/adr/0002-local-sqlite.md) içinde. Yeni hosting veya ücretli servis açılmadı. Gizli anahtarları sohbete veya `VITE_*` değişkenlerine koyma; yalnızca publishable key istemci yapılandırmasına uygundur. `.env.local`, yerel DB ve derleme çıktıları Git dışında tutulur. Marka değişirken mevcut uygulama/veri kimliği ve iç paket adları korunmuştur.

## Proje konumu

Proje kökü: C:\Users\Osman\Desktop\Projects\personal-os

Kaynaklar kökte, sürüm dosyaları outputs/, yerel Rust ve .NET geliştirme araçları work/ altındadır.
