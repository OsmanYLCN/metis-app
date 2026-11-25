# Paket 1 kabul kaydı — 25 Kasım 2026

**Kod ve erişilen ortamdaki doğrulamalar tamamlandı. İki fiziksel cihazdaki son kullanıcı kabulü yapılmadı; paket bu anlamda koşulsuz kapanmış değildir.** Bu tur Paket 2’ye geçilmedi, yeni SQL migration veya kurulum EXE’si üretilmedi.

| Kontrol | Sonuç | Kapsam |
| --- | --- | --- |
| Taşınabilir kurtarma, şifreleme, iki günlük | Geçti | Gerçek native SQLite; sentetik veriler |
| Mevcut depolama ve DPAPI regresyonu | Geçti | 70 native depolama kontrolü |
| Yeniden başlatma kilidi ve çok hesaplı taşınabilir dönüş | Geçti | Son değişiklikten sonra 4 hedefli native kontrol |
| TypeScript/Vite | Geçti | Arayüz derlemesi |
| .NET | Geçti | Release derlemesi, sıfır uyarı/hata |
| Çok oturumlu PostgreSQL | Geçti | İmzalı resmi PostgreSQL 17.12; ayrı backend süreçleri, Npgsql |
| Commit sırası ve rollback | Geçti | Bir işlem açıkken diğerinin gerçek kilitte beklemesi; görünmeyen değişiklik; boşluksuz feed |
| Eşzamanlı tekrar ve revision | Geçti | Tek makbuz/tek değişiklik, eski revision reddi |
| Hesap ayrımı | Geçti | Gerçek RLS ve transaction sonrasında claims temizliği |
| İki HTTP istemcisi, yedi modül | Geçti | Gerçek ASP.NET authentication/endpoint/Npgsql yolu; test içinde üretilen JWT/JWKS |
| İki native masaüstü veri süreci → API → PostgreSQL | Geçti | Yedi çevrimdışı/yeniden deneme/çakışma/silme/restart senaryosu |
| Canlı Supabase hazırlığı | Geçti | VerifyFull TLS, kısıtlı reader/writer, eşleşen kurulum; 0001–0009 ve workspace/taskPlan yetkileri |
| Canlı Supabase uçtan uca yazma ve iki fiziksel cihaz | Yapılmadı | Kişisel kayıtlara dokunulmadı; ikinci fiziksel cihaza erişim yok |

API senaryoları ASP.NET TestServer üzerinden gerçek middleware ve endpoint’leri çalıştırır; üretim internet ağı, proxy veya fiziksel cihaz bağlantısı bu testte taklit edilmez. JWT/JWKS sadece testte üretilir; canlı Supabase Auth bu testin sağlayıcısı değildir.

## Tekrarlama

`npm.cmd run test:real-postgres` ayrı ve geçici cluster oluşturur, sadece 127.0.0.1’de dinler, test sonunda kapatır; Windows servisi kurmaz. `METIS_PG_BIN` PostgreSQL bin klasörünü gösterebilir; varsayılan `work/postgresql/pgsql/bin`. Resmi [Windows paketleri](https://www.postgresql.org/download/windows/) / [EDB arşivi](https://www.enterprisedb.com/download-postgresql-binaries) kullanıldı. Araçlar `work/`, sonuçlar `test-results/` altında Git dışında tutulur. Testte kullanılan trust authentication yalnızca bu geçici yerel cluster içindir; üretim ayarı değildir.

`npm.cmd run check:central` mevcut `metis-local-api` User Secrets ayarlarını kullanarak yalnızca metadata okur. Anahtar/parola veya kişisel satırları yazdırmaz; sorgular read-only transaction’da çalışır. Eksik migration varsa sadece numarasını gösterir, hiçbir migration çalıştırmaz.

Bu oturumun kanıtları:

- `test-results/real-postgres-6FHAjc/report.json`
- `test-results/dual-client-run-9PGsYF/report.json`
- Canlı hazırlık komutu exit 0; reader/writer bağlantısı, kurulum ve 0001–0009 kontrolü geçti.

## İkinci cihaz olduğunda son kabul

1. İki cihazda aynı sürüm ve aynı Metis hesabını aç. API bağlantısı hazır olsun. Veri ve eşitlemede alma/göndermeyi aç.
2. A cihazında yalnızca deneme için bir not oluştur. B’de göründüğünü doğrula. B’de gövdesini değiştir, A’da değiştiğini gör.
3. İki cihaz çevrimdışıyken aynı notun başlığını farklı değiştir. Bağlantı gelince çakışmanın görünmesini ve seçimin iki cihazda da aynı sonuca ulaşmasını kontrol et.
4. Deneme notunu sil, diğer cihazda silindiğini doğrula. Yeniden açılışta silinen not tekrar oluşmamalı.
5. [Taşınabilir yedek rehberi](portable-recovery.md) ile yeni/ayrı Windows profilinde kurtarmayı kontrol et. Gerçek çalışma alanını deneme amacıyla değiştirme; mevcut alanın yedeğini alıp koru.

Bu son kabul kaydı gelmeden “iki fiziksel cihazda doğrulandı” veya “Paket 1 yüzde 100 kapandı” denmez.
