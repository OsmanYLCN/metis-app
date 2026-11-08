# M0.15 — Ayrı writer yapılandırması ve create/rename HTTP sözleşmesi

2026-11-08. Sunucu dilimidir; masaüstü sürümü **0.12.0** olarak kalır ve yeni EXE üretilmedi.

## Değişiklikler

- `CentralTaskWriterOptions`: reader'dan ayrı provider, kullanıcı/parola, pooler/direct host, Project Ref ve VerifyFull TLS ayarları. Varsayılan Disabled; yalnızca `metis_writer` veya pooler'da `metis_writer.PROJE_REF` kabul edilir.
- `ITaskWriter` ve kapalı üretim adaptörü: yapılandırma yokken sahte başarı üretilmez.
- `PostgresTaskWriter` DI yaşam döngüsüne bağlandı; writer bağlantı havuzu reader'dan ayrıdır ve en fazla 2 bağlantıdır.
- `POST /api/v1/tasks` ve `PATCH /api/v1/tasks/{id}`: yalnızca doğrulanmış Supabase kullanıcı tokenı, no-store yanıtlar, 4 KiB JSON sınırı, kesin alan/ID doğrulaması ve sabit hata kodları.
- Development CORS yalnızca bilinen yerel masaüstü/Vite originleri için GET/POST/PATCH ve Authorization/Content-Type'a genişletildi. Production CORS açılmadı.
- `configure-central-task-writer.ps1`: parolayı gizli terminal girişinden stdin ile repo dışındaki ayrı User Secrets alanına yazar. Windows PowerShell 5.1 ve PowerShell 7 sentetik UTF-8 parola testi geçti; gerçek secret yazılmadı.
- [Canlı kurulum rehberi](central-writer-setup.md) hazırlandı; bu dilimde uygulanmadı.

## Doğrulama

- API/JWT/okuma/yazma sözleşmeleri: **55 kontrol** doğrudan TestServer paketinde geçti; writer PostgreSQL entegrasyonu etkin çalıştırmada toplam **56 kontrol** geçti.
- 6 yeni HTTP grubu: kapalı writer, geçersiz/anonim/elevated token, create hesap/komut eşleme, replay/rename, bilinmeyen alan-owner override-medya türü, sabit conflict/not-found/outage cevapları.
- Gerçek Npgsql TCP + izole PostgreSQL: doğrudan adapter işlemlerine ek olarak imzalı test kullanıcısı ile gerçek HTTP POST ve replay çalıştı. Veritabanı yeniden açıldığında iki görev ve tam 3 başarılı receipt doğrulandı.
- .NET Release: **0 uyarı, 0 hata**.
- Ayrı gerçek API süreci: **6/6** geçti; merkezi okuma/yazma token olmadan 401, health POST 405 ve yerel CORS doğrulandı.
- İlk paralel test turunda aynı DLL kilidi oluştu; paketler sıraya alındı. Kısıtlı çalışma ortamı yerel TCP ve Windows Data Protection geçici klasörünü engelledi; API smoke profili proje içindeki izole `test-results` alanına taşındı ve TCP testi gerekli izinle yeniden geçti. Ürün ayarı/verisi değişmedi.

## Gerçeklik ve sınır

Canlı Supabase'e migration 0003 uygulanmadı, `metis_writer` parolası oluşturulmadı ve `CentralTaskWriter` User Secrets ayarı yazılmadı. Canlı API bu nedenle writer için kapalı kalır. Hiçbir gerçek görev eklenmedi veya değiştirilmedi.

Masaüstü halen yalnızca SQLite görevlerini yazar; HTTP uçlarını çağırmaz. Silme/tamamlama, otomatik yükleme, çatışma arayüzü ve sync yoktur. Sonraki küçük adım, kullanıcının onayıyla migration 0003 + ayrı writer parolası/yerel ayarı ve ardından canlı hesapta kontrollü tek görev create/replay/rename doğrulamasıdır.

Çıktılar: `outputs/Metis-M0.15-source.zip`, `outputs/M0.15-Dogrulama.md`.
