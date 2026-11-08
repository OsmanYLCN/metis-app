# M0.11 doğrulama — 2026-11-08

## Sonradan tamamlanan canlı bağlantı kontrolü — 2026-11-08

Kullanıcı migration'ları, installation kaydını ve okuyucu parolasını hazırladı. Supabase panelinden indirdiği kök sertifika `%LOCALAPPDATA%/Metis/certificates/supabase-prod-ca-2021.crt` konumuna kopyalandı; yalnızca sertifika yolu yerel User Secrets'a eklendi. Parola görüntülenmedi/değiştirilmedi.

Canlı Supabase PostgreSQL bağlantısı **VerifyFull TLS** ile başarılı. Üretim `PostgresTaskReader` üzerinden rol, RLS, migration ve proje eşleşmesi kontrolleri geçti. Rastgele sentetik hesap ID'siyle salt okuma 0 kayıt döndürdü; veri eklenmedi/değiştirilmedi. Bu, gerçek kullanıcı JWT'siyle uçtan uca liste doğrulaması değildir; o kontrol henüz yapılmadı. Açık API süreci yeni sertifika ayarı için yeniden başlatılmalı. Aşağıdaki ilk teslim kaydındaki canlı bağlantı bekleme durumu bu ek kontrolle güncellenmiştir.

Sürüm 0.11.0. PostgreSQL okuma adaptörü tamamlandı; canlı Supabase veritabanı kurulumu ve canlı kullanıcıyla okuma henüz doğrulanmadı. Masaüstü görevleri yerel SQLite'ta çalışmaya devam eder.

## Oluşan parçalar

- `services/api/Modules/Tasks/CentralTaskOptions.cs`: proje/host/rol doğrulaması, TLS, bağlantı havuzu ve süre sınırları.
- `services/api/Modules/Tasks/PostgresTaskReader.cs`: Npgsql ile parametreli okuma; doğrulanmış hesap, transaction-local claim, RLS ve rol kontrolleri.
- `services/api/Database/Migrations/0002_task_reader.sql`: ayrı okuyucu rolü, RLS politikası ve kurulumun proje kimliği.
- Görev status endpoint'i yapılandırma varlığını değil gerçek okuma hazırlığını ölçer. Bağlantı kapalı veya yetki yanlışsa hazır görünmez.
- `tests/api/CentralTaskConfigurationChecks.cs`, `tests/api/PostgresAdapterChecks.cs`, `scripts/test-postgres-adapter.mjs`.
- `scripts/configure-central-tasks.ps1`: gizli terminal girişi ve stdin üzerinden repo dışındaki .NET User Secrets'a yerel ayar kaydı.
- [Kurulum rehberi](central-postgres-setup.md), [ADR-0010](adr/0010-postgres-task-reader.md), README ve sürüm etiketleri.

## Gerçekten çalıştırılan kontroller

- .NET Release solution derlemesi: **0 uyarı, 0 hata**.
- API/JWT/yapılandırma: **39 temel kontrol**; PostgreSQL testinde ek adaptör grubu ile her çalıştırmada **40 kontrol** geçti. Testler geçici imzalama anahtarları ve sentetik JWKS kullanır.
- Npgsql → TCP → yerel PGlite PostgreSQL: başarılı okuma, iki hesabın tekrarlı havuz kullanımı, sayfalama, diğer hesaba ait/silinmiş kayıtların gizlenmesi, proje uyuşmazlığı, iptal ve işlem sonrası claim temizliği geçti.
- Altı ayrı olumsuz senaryo geçti: tablo UPDATE izni, sütun UPDATE izni, BYPASSRLS rolü, kapalı RLS, eksik kurulum kaydı ve kapalı veritabanı. Status `unavailable`, liste 503; gizli bağlantı bilgisi yanıtlanmadı. Her senaryoda temel paket yeniden çalıştı; bunlar 280 farklı test olarak sayılmaz.
- Şema/RLS paketi: **8/8** geçti (7 alt senaryo + ana test).
- Ayrı gerçek API süreci smoke paketi: **6/6** geçti (5 alt senaryo + ana test).
- TypeScript/Vite üretim derlemesi ve Tauri Windows Release EXE derlemesi başarılı.
- PowerShell kurulum yardımcısının sözdizimi kontrolü geçti. Geçici User Secrets deposuna yazma/geri okuma denemesi otomatik güvenlik incelemesince engellendi; araç yalnızca “blocked by policy” bildirdi. Bu yardımcı için uçtan uca kayıt başarısı iddia edilmez, kullanıcının gerçek ayarlarına yazılmadı.

## Gerçeklik sınırı

PGlite, PostgreSQL sorgularını ve izinlerini gerçekten yürütür; socket köprüsü üzerinden gerçek Npgsql sürücüsü test edildi. Supabase auth şeması ve hesaplar sentetiktir. Tek backend kullanan bu test, gerçek PostgreSQL çoklu oturum davranışını, Supavisor, TLS sertifikalarını veya canlı parola doğrulamasını kanıtlamaz. Canlı projeye migration uygulanmadı, bağlantı parolası alınmadı ve harici servis açılmadı.

Masaüstünde yalnızca sürüm etiketi değişti; önceki UI/Rust görev testleri yeniden çalıştırılmadı. Kullanıcının yerel görev DB'sine ve oturum kasasına dokunulmadı. Çalışan yerel API zorla kapatılmadı; yeni backend kodu normal yeniden başlatmada yüklenir. API EXE içine paketlenmez.

## Çıktılar ve kalan adım

`outputs/Metis-M0.11.exe`, `outputs/Metis-M0.11-source.zip`, `outputs/M0.11-Dogrulama.md`.

Canlı bağlantı için kullanıcının Supabase panelindeki migration/rol ayarlarını ve yerel parola girişini [rehbere](central-postgres-setup.md) göre tamamlaması gerekiyor. Sonrasında geçerli hesapla status/liste kontrolü yapılacak. Merkezi yazma ve sync ayrı onaylı dilimlerde; bu sürümde masaüstü görevlerinin bulutta görünmesi beklenmemeli.
