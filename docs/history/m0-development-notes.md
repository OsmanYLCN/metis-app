# Tarihsel geliştirme notları

Bu dosya eski README arşividir; güncel kurulum ve kapsam için kök README esas alınır. Buradaki eski göreli bağlantılar depo köküne göre yazılmıştır.

# Metis

**M0 / Foundation — Dilim 50; masaüstü v0.48.0.** Windows masaüstü için Tauri 2 + React + TypeScript + Vite; ASP.NET Core 10 API, yerel SQLite ve Supabase oturum/görev bağlantısı. Metis; görev, takvim etkinlikleri, not, proje, hedef, gelir/gider, kategori bütçeleri, analiz ve uygulama içi hatırlatmalar sunar. Görevlerde arama/filtreleme/sıralama, takvimde aylık ajanda, hedeflerde filtreleme, proje detayında bağlı görevler, notta güvenli biçimlendirme önizlemesi vardır. Dashboard bugünün planını, geciken işleri ve yaklaşan hatırlatmaları gösterir. Finans ve hatırlatma kayıtları cihazda tutulur; sistem bildirimi ve arka plan uyarısı henüz yoktur. Public Supabase ve veritabanı bağlantıları Git dışı yerel ayarlarda tutulur. Tam ürün veya tamamlanmış M0 değildir.

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

M0.23: Buluta gönderilmiş görevi tamamla, yeniden aç ve sil. İşlem önce bu cihazda kalıcı kuyruğa alınır; ağ yanıtı kaybolursa aynı işlem kimliğiyle tekrar denenir. [Kurulum ve doğrulama](docs/verification-m0.23.md).

M0.24: Açık oturumda görev ekranı açılınca ve yeni görev/başlık kaydı sonrasında uygun bekleyen işlemler otomatik gönderilir. Bağlantı hatasında kuyruk korunur; elle yeniden deneme mümkündür. [Doğrulama](docs/verification-m0.24.md).

M0.25: Hesaba ayrılmış yerel Notlar ve Projeler ekranları; oluşturma, düzenleme, arama, sabitleme/durum ve silme. [Doğrulama](docs/verification-m0.25.md).
M0.24 EXE'deki eksik görev kuyruğu izinleri M0.25 paketinde düzeltildi.

## Bu dilimde çalışanlar

- Minimal Türkçe uygulama kabuğu, 12 modül için gezinme, açık/koyu/sistem teması.
- Dashboard temel durum ekranı; Windows için gerçek yerel Görevler, Notlar ve Projeler ekranları. Diğer modüller açıkça işaretli boş ekranlardır.
- Gerçek yerel API üzerinden bağlantı kontrolü, 4 saniye zaman aşımı ve yeniden deneme.
- `GET /health`: API sürecinin canlılık kontrolü. Veritabanı veya sync hazırlığını ölçmez.
- Monorepo, mimari karar kaydı, gerçek API smoke testleri ve arayüz kontrolleri.
- Gerçek yerel SQLite dosyası; atomik ilk migration, migration günlüğü ve yeniden açılışta korunan temel kayıt.
- Yerel depolama durum kartı; tarayıcıda desteklenmediğini, masaüstünde başarı/hata durumunu açıkça gösterir.
- Hesap/oturum sözleşmesi, başlangıçta doğrulanan sağlayıcı ayarları ve gerçek API'den okunan hesap durum kartı.
- Supabase yapılandırıldığında public JWKS ile gerçek sunucu token doğrulaması.
- Mevcut Auth kullanıcısı için e-posta/parola giriş formu, API tarafından doğrulanan oturum, cihazdan çıkış, iptal/hata ve süre sonu yönetimi. Varsayılan oturum bellektedir; hatırla seçilirse refresh token şifreli kasaya yazılır ve yenilenir.

**Kapsam sınırı:** Görevler, Notlar ve Projeler Windows uygulamasında gerçek yerel kayıtlardır; diğer iş modülleri yerel önizlemedir. Health ve masaüstündeki SQLite mock değildir. SQLite şema sürümü 6'dır. Kullanıcı canlı girişi, oturum geri yüklemeyi ve kontrollü sentetik writer kontrolünü başarılı bildirdi; otomatik testlerde sağlayıcı yanıtları mock kullanılır. Uygun bekleyen görev işlemleri açık oturumda otomatik, ayrıca kullanıcı düğmesiyle buluta gönderilir. Buluttan indirme ve çift yönlü eşitleme, R2 ve hosting henüz yoktur. Tema tercihi sadece oturumda tutulur. Tarayıcı önizlemesi ayrı web ürünü değildir.

## Hazır Windows uygulaması

Güncel **outputs/Metis-M0.25.exe** kullanılabilir Notlar ve Projeler ekranlarını ekler. [M0.25 doğrulama](docs/verification-m0.25.md). SQLite şema 6'ya yükselir. Eski sürümden geçerken önce bütün Metis pencerelerini kapat. Önceki teslim notları aşağıda tarihsel kayıt olarak durur.

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
npm.cmd run test:postgres-writer # Atomik görev yaşam döngüsü + işlem günlüğü; yalnızca izole test DB
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

M0.35: Notlarda günlük plan/toplantı, projelerde plan şablonu; Ctrl+S ile kayıt, sabit not ve proje durum filtreleri. Hedef ve takvim düzenlemelerinde modül değiştirirken kaydedilmemiş içerik uyarısı. Tema tercihi cihazda kalıcıdır. Filtreler yüklenmiş listeyi kullanır; ek kayıtlar Daha fazla göster ile açılır. Bu dilimde EXE üretilmedi.

M0.36: Projeden proje filtreli görevlere geçiş ve yeni görevde hazır proje seçimi; Dashboard geciken/haftalık görev geçişleri; hızlı görev görünümleri ve filtreleri temizleme; ertelenmiş bildirimleri listeleme ve ertelemeyi kaldırma. Bildirimler mevcut 90 gün geçmiş/30 gün gelecek penceresini kullanır. EXE üretilmedi.

M0.37: Finans kayıtlarında başlık/kategori araması ve gelir/gider filtresi; bütçede doğrudan düzenleme; Finans ekranında tüm aylık kayıtlardan hesaplanan toplamlar ve kategori dağılımı. Geçmiş listesi son 500 kayıtla sınırlıdır. EXE üretilmedi.

M0.38: Analizlerde tüm aylık kayıtları kapsayan finans toplamları; önceki ay ile gelir/gider karşılaştırması; hızlı ay geçişleri; onaylı bütçe kaldırma. Karşılaştırma seçili ayın mevcut kayıtlarını önceki ayın tamamıyla karşılaştırır. EXE üretilmedi.

M0.39: Ctrl+K veya üst çubuktan hesap kapsamlı yerel arama: görev, not, proje ve hedef başlıkları; not/proje/hedef içerikleri; tür filtresi ve ilgili modüle geçiş. Görev/not/projede tür başına 1000, hedeflerde 200 kayıt taranır; sınıra ulaşılırsa uyarılır. Sonuç ilk 50 ile sınırlıdır. EXE üretilmedi.

M0.40: Takvimde haftalık görünüm ve hafta geçişleri; etkinliği yeni taslak olarak kopyalama; kayıt tarihinde seçili ayı güncelleme; yeni etkinlik tekrarlarında sabit kayıt kimliği. Kopya ancak Kaydet ile yazılır. EXE üretilmedi.

M0.41: Günlük kullanıma odaklı Dashboard; görev/not/proje oluşturma kısayolları, üstte günlük plan ve hatırlatmalar, açılır hesap/bağlantı kontrolleri. Giriş isteyen modüller hesap bölümünü açık getirir. EXE üretilmedi.

M0.42: Proje görevleri doğrudan hesap/proje kapsamlı sorguyla sayfalanır; ilk 1000 genel görev tarama sınırı kaldırıldı. Görev ekranında proje/projesiz filtresi veritabanında uygulanır. Diğer görev filtreleri yüklenmiş kayıtları kullanır. EXE üretilmedi.

M0.43: Görevlerde başlık araması, durum/tarih/öncelik/proje filtreleri ve sıralama tüm yerel kayıtlar üzerinde, sayfalama öncesinde uygulanır. Türkçe I/İ araması desteklenir. Başlık araması için aday kayıtlar yerel bellekte taranır; çok büyük listelerde indeksli arama sonraki optimizasyondur. EXE üretilmedi.

M0.44: Finans geçmişinde 100 kayıtlık sayfalama; başlık/kategori araması ve gelir/gider filtresi tüm aylık kayıtlar üzerinde uygulanır. Ara düğmesi sorguyu uygular. Önceki 500 kayıt gösterim sınırı kaldırıldı. EXE üretilmedi.

M0.45: Not/proje kopyalama (yeni taslak), yüklenen listeyi sıralama; notlarda seçili satırlar için başlık/madde/kontrol listesi araçları. Hedef kopyalama, açıklamada arama, tarih/ilerleme/ad sıralaması, hızlı ilerleme ve Ctrl+S. Proje görevleri kopyalanmaz; hedef kopyasında tarih/ilerleme sıfırlanır. Yeni taslaklar Kaydet ile yazılır. EXE üretilmedi.

M0.46: Not/proje filtreleri ve sıralaması veritabanında sayfalama öncesinde uygulanır. Dashboard en son güncellenen beş sabit notu gösterir. Not/proje kaydından sonra liste seçili filtreye göre yenilenir. EXE üretilmedi.

M0.47: Ortak arama altı modülde (görev/not/proje/hedef/etkinlik/finans) tüm hesap kapsamlı yerel kayıtları tarar. Türkçe harf eşleme, başlık öncelikli sıralama, sonuç sayısı ve 50 kayıtlık sayfalama. Önceki tür başına tarama sınırları kaldırıldı. Sonuç ilgili modülü açar; tek kayıt detayına geçiş henüz yok. Arama yerelde bellek taraması kullanır; çok büyük veride indeksli arama sonraki optimizasyondur. EXE üretilmedi.

M0.48: Aramadan not/proje detayına ve Dashboard sabit notlarından doğrudan not düzenleyicisine geçiş. Kayıt kimliği, türü ve hesap kapsamı yerel katmanda doğrulanır; liste sayfasına bağlı değildir. Aynı modülde kayıt değiştirirken kaydedilmemiş taslak uyarısı korunur. Diğer arama türleri ilgili modülü açar. EXE üretilmedi.

M0.49: Arama/bildirim/Dashboard hedef ve etkinlik sonuçları doğrudan hesap kapsamlı detayı açar. Etkinlikte takvim ayı da güncellenir. Finans araması ilgili ayı açar; henüz tek finans satırını seçmez. Finans taslağıyla modül geçişinde uyarı eklendi. EXE üretilmedi.

M0.50: Hedefler ekranında tüm kayıtları kapsayan başlık/açıklama araması, durum filtresi, tarih/ilerleme/ad sıralaması ve 100 kayıtlık sayfalama. Sonuç sayısı gösterilir. Dashboard/analiz/hatırlatma özetleri eski sınırlı liste çağrısını kullanmaya devam eder. EXE üretilmedi.

M0.51: Hedefler, Genel Bakış ve Analizlerde hesap kapsamlı tam hedef özeti: toplam/aktif/bekleyen/tamamlanan/geciken sayıları, aktif hedeflerin ortalama ilerlemesi ve tarihi en yakın beş aktif hedef. SQL toplamları 200 kayıt sınırından bağımsızdır. Geciken: aktif ve tarihi bugünden önce olan hedef. Analiz hedeflerinden doğrudan detaya geçilir. Görev/proje özetleri ve bildirim tarama sınırları bu dilimde değişmedi. Arayüz derlemesi ve 200 üstü kayıt/hesap ayrımı için hedefli Rust testi; dağıtım EXE’si üretilmedi.

M0.52: Genel Bakış/Analiz görev ve proje sayıları tüm hesap kapsamlı yerel kayıtlardan SQL toplamlarıyla hesaplanır. Geciken görevlerde 90 günlük sınır kaldırıldı. Bugünün görevleri ve haftalık açık görevler ayrı filtreli sorgularla gösterilir; kart listelerinde ilk beş kayıt görünür. Bugünkü etkinlik toplamı sınırsızdır. Aktif proje listesi son güncellenen beş projeyi gösterir ve detaya açılır. Bildirim/takvim listelerinin kendi sınırları bu dilimde değişmedi. Yeni SQL kurulumu veya dağıtım EXE’si gerekmez.

M0.53: Günlük kullanım paketi. Arama, Genel Bakış, takvim ve bildirimlerden görev kimliğiyle hesap kapsamlı doğrudan erişim; takvimde seçili güne hazır tarihli görev oluşturma; görev kopyasını yeni taslak olarak hazırlama; bugün/yarın/bir hafta sonra tarih kısayolları; görev taslağında gezinme ve iptal uyarıları; görev/etkinlik düzenleyicisinde Ctrl+S. Takvimde tüm yerel saatli etkinliklerde SQL çakışma sayımı (başlangıç ve bitişi olan kayıtlar, bitiş/başlangıç eşitliği çakışma sayılmaz); uyarı kaydı engellemez. Takvim/görev liste limitleri bu dilimde değişmedi. Dağıtım EXE’si ve yeni Supabase SQL kurulumu yok.

M0.54: Finans kayıtlarında düzenleme, yeni taslak olarak kopyalama, arama sonucundan doğrudan kaydı açma, son kullanılan 100 kategoriden öneriler, Ctrl+S ve taslak iptal uyarıları. Yerel düzenleme, beklenen kayıt içeriğini transaction içinde karşılaştırır; eski içerik üzerine sessiz yazmaz ve aynı sonucu tekrar kaydetmek idempotenttir. Bu içerik karşılaştırması bulut revision/sync protokolünün yerine geçmez. Ay değişince aylık toplamlar/bütçeler yenilenir. Yeni migration, Supabase kurulumu veya dağıtım EXE’si yok.

M0.55: Not önizlemesinde etkileşimli kontrol listesi ve tamamlanma sayacı; başlıklara atlama; kalın/italik/satır içi kod araçları ve güvenli React metin önizlemesi (tam Markdown motoru değildir). Kontrol kutuları taslağı değiştirir, Kaydet ile kalıcı olur. Vazgeç işleminde kirli taslak uyarısı. Proje görevlerinde tüm kayıtları kapsayan durum/öncelik filtreleri ve doğrudan görev detayına geçiş. Arayüz derlemesi doğrulandı; native değişiklik/migration ve dağıtım EXE’si yok.

M0.56: Ortak yerel hatırlatma sorgusu, başlık araması (Türkçe harf eşleme), tür/durum filtreleri, 50 kayıtlık sayfalama ve tam sonuç/okunmamış sayısı. Açık görev ve aktif hedeflerde geçmiş 90 gün ve 200/500 kayıt tarama sınırları kaldırıldı; gelecek ufku 30 gün. Geçmiş etkinlikler gösterilmez. Durumlar kaynak kimliği+tarih ile doğrudan birleştirilir; 2000 durum sınırına bağlı değildir. Genel Bakış aynı sorguyu kullanır. Yarın/bir hafta erteleme ve kaldırma. Sistem/push bildirimi yok. Arama adayları yerel bellekte filtrelenir. Yeni migration/servis/EXE yok.
