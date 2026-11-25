# Metis

Windows masaüstü v0.49.0 · SQLite şema 14 · **Paket 1 kod/doğrulama çalışmaları tamam; iki fiziksel cihaz kabulü bekliyor.**

Tauri 2 + React + TypeScript + Vite masaüstü; ASP.NET Core 10 API; yerel SQLite ve merkezi PostgreSQL/Supabase. Android ve web henüz uygulanmadı.

## Güncel gerçek kapsam

| Alan | Yerel çalışma | Merkezi veri |
| --- | --- | --- |
| Görevler | Oluşturma, düzenleme, tamamlanma, silme, proje/tarih/öncelik | Create/rename/complete/delete gönderimi ve kalıcı işlem kuyruğu var. Sunucuda değişiklik okuma ve masaüstünde ayrı bulut önbelleği/karşılaştırma var; onaylı yerel uygulama var. Proje/tarih/öncelik merkezi modelde; masaüstü plan gönderimi ortak revision zincirine bağlı; otomatik gönderim isteğe bağlı. |
| Notlar, projeler | Gerçek kayıtlar, arama, önizleme, proje görevleri | Merkezi yazma API’si ve değişiklik günlüğü hazır; bulut önbelleği/karşılaştırma var; onaylı yerel uygulama var; elle/otomatik create/update/delete gönderimi ve kesin reddi kaldırma var |
| Takvim, hedefler | Gerçek kayıtlar ve planlama ekranları | Merkezi yazma ve değişiklik akışı hazır; bulut önbelleği/karşılaştırma var; onaylı yerel uygulama var; elle/otomatik create/update/delete gönderimi ve kesin reddi kaldırma var |
| Finans, bütçeler | TRY kayıtları, düzenleme, bütçe ve aylık analiz | Merkezi doğrulamalı yazma ve değişiklik akışı hazır; bulut önbelleği/karşılaştırma var; onaylı yerel uygulama var; elle/otomatik create/update/delete gönderimi ve kesin reddi kaldırma var |
| Bildirimler | Uygulama içi hatırlatmalar, erteleme ve filtreler | Sistem bildirimi / arka plan servisi yok |
| Genel Bakış, analiz, arama | Yerel kayıtlardan hesaplanır | Bağımsız merkezi veri kaynağı değil |
| Veri ve eşitleme | Hesap bazlı yerel yedekler ve tüm cihazı kapsayan parolalı taşınabilir yedek; iki gönderim günlüğüyle güvenli kurtarma | İsteğe bağlı alma/gönderme, ortak snapshot ile birleştirme, görünür çakışma çözümü ve geri yükleme sonrası uzlaştırma |
| Dosyalar, Otomasyonlar, Asistan | Gezinme iskeleti | Uygulanmadı |

Gerçek Supabase oturumu ve görev reader/writer bağlantısı önceki çalışmalarda kullanıcı tarafından doğrulandı. 25 Kasım 2026’da canlı Supabase TLS/rol/kurulum ve 0001–0009 hazırlığı yalnızca metadata okuyarak tekrar doğrulandı; canlı hesap üzerinde yazma testi yapılmadı. Health yalnızca API sürecinin canlılığını gösterir. UI testlerinin bazıları mock sağlayıcı/IPC kullanır; native SQLite ve DPAPI testleri gerçek Windows bileşenleriyle sentetik geçici veride çalışır.

## Paket 1: veri koruma ve eşitleme

İş sırası, tamamlananlar ve kabul ölçütleri: [Paket 1 takip belgesi](docs/package-1.md).
Yeni sunucu değişiklik akışı ve tek SQL kurulum adımı: [0006 kurulumu](docs/change-feed.md).
Proje/not sunucu kurulumu: [0007 kurulumu](docs/central-workspace.md).
Hedef/takvim/finans/bütçe sunucu kurulumu: [0008 kurulumu](docs/central-domains.md).
Görev planı ve proje bağlantısı: [0009 kurulumu](docs/central-task-planning.md).
Masaüstünde bulut kayıtlarını indirme ve inceleme: [Bulut karşılaştırması](docs/cloud-inbox.md).
Altı modülde elle buluta gönderim: [Kullanım ve sınırlar](docs/manual-cloud-upload.md).
Otomatik gönderim, görev planı ve geri yükleme sonrası uzlaştırma: [Kullanım rehberi](docs/automatic-sync-recovery.md).
Güvenli gelen birleştirme ve iki izole istemci doğrulaması: [Kullanım ve kapsam](docs/incoming-merge.md).
Geri yüklemenin kapsamı ve kullanımı: [Yerel yedekleme](docs/local-recovery.md).

İki yedek türü vardır: `.metisbackup` aynı Windows profiline bağlı hesap yedeğidir; `.metisportable` parola ile korunan ve tüm yerel hesaplarla iki gönderim günlüğünü taşıyan cihaz yedeğidir. Canlı SQLite dosyası şifreli değildir. Oturum tokenları ve API/veritabanı parolaları yedeklere girmez. Taşınabilir geri yükleme tüm yerel veri alanını değiştirir ve eski dosyaları korur; bulutu eski hale döndürmez. [Taşınabilir kurtarma](docs/portable-recovery.md), [Paket 1 kabul kaydı](docs/package-1-acceptance.md).

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
