# Metis

Windows masaüstü v0.49.0 · SQLite şema 14 · **Paket 1 sürüyor; tamamlanmadı.**

Tauri 2 + React + TypeScript + Vite masaüstü; ASP.NET Core 10 API; yerel SQLite ve merkezi PostgreSQL/Supabase. Android ve web henüz uygulanmadı.

## Güncel gerçek kapsam

| Alan | Yerel çalışma | Merkezi veri |
| --- | --- | --- |
| Görevler | Oluşturma, düzenleme, tamamlanma, silme, proje/tarih/öncelik | Create/rename/complete/delete gönderimi ve kalıcı işlem kuyruğu var. Sunucuda değişiklik okuma ve masaüstünde ayrı bulut önbelleği/karşılaştırma var; onaylı yerel uygulama var. Proje/tarih/öncelik merkezi modelde; masaüstü plan gönderimi henüz bağlı değil. |
| Notlar, projeler | Gerçek kayıtlar, arama, önizleme, proje görevleri | Merkezi yazma API’si ve değişiklik günlüğü hazır; bulut önbelleği/karşılaştırma var; onaylı yerel uygulama var; gönderim henüz yok |
| Takvim, hedefler | Gerçek kayıtlar ve planlama ekranları | Merkezi yazma ve değişiklik akışı hazır; bulut önbelleği/karşılaştırma var; onaylı yerel uygulama var; gönderim yok |
| Finans, bütçeler | TRY kayıtları, düzenleme, bütçe ve aylık analiz | Merkezi doğrulamalı yazma ve değişiklik akışı hazır; bulut önbelleği/karşılaştırma var; onaylı yerel uygulama var; gönderim yok |
| Bildirimler | Uygulama içi hatırlatmalar, erteleme ve filtreler | Sistem bildirimi / arka plan servisi yok |
| Genel Bakış, analiz, arama | Yerel kayıtlardan hesaplanır | Bağımsız merkezi veri kaynağı değil |
| Veri ve eşitleme | Hesap kapsamlı şifreli geri dönüş noktaları, önizlemeli geri yükleme, görev kuyruğu durumu | Geri yükleme sonrası gönderim kilitlenir; bulutla uzlaştırma henüz yok |
| Dosyalar, Otomasyonlar, Asistan | Gezinme iskeleti | Uygulanmadı |

Gerçek Supabase oturumu ve görev reader/writer bağlantısı önceki çalışmalarda kullanıcı tarafından doğrulandı. Bu sürümde canlı bağlantı yeniden denenmedi. Health yalnızca API sürecinin canlılığını gösterir. UI testlerinin bazıları mock sağlayıcı/IPC kullanır; native SQLite ve DPAPI testleri gerçek Windows bileşenleriyle sentetik geçici veride çalışır.

## Paket 1: veri koruma ve eşitleme

İş sırası, tamamlananlar ve kabul ölçütleri: [Paket 1 takip belgesi](docs/package-1.md).
Yeni sunucu değişiklik akışı ve tek SQL kurulum adımı: [0006 kurulumu](docs/change-feed.md).
Proje/not sunucu kurulumu: [0007 kurulumu](docs/central-workspace.md).
Hedef/takvim/finans/bütçe sunucu kurulumu: [0008 kurulumu](docs/central-domains.md).
Görev planı ve proje bağlantısı: [0009 kurulumu](docs/central-task-planning.md).
Masaüstünde bulut kayıtlarını indirme ve inceleme: [Bulut karşılaştırması](docs/cloud-inbox.md).
Geri yüklemenin kapsamı ve kullanımı: [Yerel yedekleme](docs/local-recovery.md).

Şu anda yedekler aynı Windows profiline bağlıdır, taşınabilir felaket kurtarma yedeği değildir. Yedek dosyaları şifrelidir; canlı SQLite dosyası şifreli değildir. Oturum tokenları ve API/veritabanı parolaları yedeklere girmez. Geri yükleme mevcut hesabın yerel verisini değiştirir; bulutu eski hale döndürmez.

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


## Doğrulama ve dağıtım

- Arayüz: npm.cmd run build
- İlgili arayüz testleri: npm.cmd test -- <test yolu>
- Native depolama: yerel Rust araçlarıyla cargo test --offline --manifest-path apps/desktop/src-tauri/Cargo.toml
- API değişince: npm.cmd run build:api ve ilgili API testleri.

Her güncellemede dağıtım EXE’si üretilmez. outputs/ altındaki eski EXE’ler güncel kaynak kodunu temsil etmeyebilir. API hâlâ ayrı geliştirme sürecidir; hosting, installer ve otomatik güncelleme yoktur.

## Güvenlik ve servisler

Hesap kapsamı bütün yerel/merkezi veri erişiminde korunur. Aynı Windows kullanıcısına karşı yerel kayıt ayrımı bir güvenlik sınırı değildir. Gizli anahtarlar sohbete veya VITE_* alanlarına yazılmaz. .env.local ve kullanıcı sırları Git dışında kalır.

Supabase Free, R2 ve öğrenci hosting kredileri adaydır; ücretli servis veya deploy açılmadı. R2 bağlantısı henüz yoktur.

## Tarihçe

[Eski aşama notları](docs/history/m0-development-notes.md) tarihsel kayıttır; güncel tamamlanma bilgisi değildir. Mimari kararlar docs/adr/ altında korunur.
