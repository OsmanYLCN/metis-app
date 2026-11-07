# M0.10 doğrulama — 2026-11-07

Sürüm: 0.10.0. Kapsam: merkezi görev modeli, doğrulanmış kullanıcıya göre okuma endpoint'leri ve PostgreSQL erişim kuralları. Masaüstü görevleri SQLite'ta çalışmaya devam eder; merkezi bağlantı/sync eklenmedi.

## Oluşan parçalar

- `services/api/Modules/Tasks`: görev sözleşmeleri, zorunlu hesap parametreli reader arayüzü, açıkça yapılandırılmamış üretim reader'ı, Bearer erişim filtresi, status/liste/detay GET endpoint'leri.
- `services/api/Database/Migrations/0001_central_tasks.sql`: özel şema, sahiplik, anahtarlar, revision/tarih/silinme alanları, trigger ve SELECT RLS.
- `tests/api/TaskFoundationChecks.cs`: HTTP/JWT üzerinden görev erişim kontrolleri.
- `scripts/tasks-schema.test.mjs`: PostgreSQL şema/RLS testi. PGlite 0.5.15 yalnızca geliştirme bağımlılığıdır.
- ADR-0009 ve veritabanı/yerel kullanım notları.

## Kontroller

- API TestServer/JWT: **38 kontrol geçti** (önceki 31 + görev erişimi için 7 grup). Yanlış/anonim/service-role oturumu, sahte kullanıcı header'ı, hesaplar arası okuma, tombstone, sayfalama, bozuk parametreler, yanlış kapsamlı adapter ve yapılandırılmamış store kontrol edildi.
- PostgreSQL motoru: **7 alt senaryo + ana test, 8/8 geçti.** RLS hesap ayrımı, anon/eksik claim reddi, görev yazma yetkilerinin kapalı olması, service-role/journal yetkileri, sunucu revision/tarihleri, immutable sahiplik, constraint ve migration tekrar çalıştırma koruması doğrulandı.
- Gerçek ayrı API süreci: **5 alt senaryo + ana test, 6/6 geçti.** Health, CORS, görev 401, merkezi yazma 405 ve kimlik yanıtı doğrulandı; test ayrı geçici port kullandı.
- .NET Release: **0 uyarı, 0 hata**.
- TypeScript/Vite üretim ve Tauri Windows Release derlemesi başarılı.

## Gerçeklik sınırı

Supabase'e SQL uygulanmadı ve merkezi PostgreSQL bağlantısı kurulmadı. Gerçek hesap/anahtar/parola kullanılmadı. JWT testinde JWKS taşıması ve görev reader'ı fixture'dır; PostgreSQL testinde Supabase auth yardımcıları/rolleri sentetiktir. PostgreSQL'in kendisi ve izin motoru gerçek yerel WASM motorunda çalışır. Üretim API'sinde fixture store yoktur: kimliği doğrulanmış liste/detay isteği 503 `central_store_not_configured` alır; boş listeyle başarı taklit edilmez.

Masaüstü iş akışı ve Rust kayıt kodu değişmedi; yalnızca sürüm etiketi güncellendi. Bu nedenle önceki görev UI/Rust/native paketleri yeniden çalıştırılmadı. Mevcut kullanıcı DB'si ve oturum kasasına dokunulmadı. Çalışan yerel API kapatılmadı; yeni endpoint'ler API'nin bir sonraki normal yeniden başlatılmasında yüklenir.

## Çıktılar / sonraki adım

`outputs/Metis-M0.10.exe`, `outputs/Metis-M0.10-source.zip`, `outputs/M0.10-Dogrulama.md`.

Bu sürümde görünür yeni bulut özelliği beklenmemeli. Güncel masaüstünü kullanmak istersen eski EXE'yi kapatıp yenisini aç; yerel API giriş için açık kalmalı. Şu anda Supabase panelinde bir işlem yapman gerekmiyor.

Sonraki küçük dilim: PostgreSQL bağlantı adaptörü ve ayrı test veritabanında gerçek kullanıcıya bağlı okuma doğrulaması. Ardından merkezi yazma/çatışma sözleşmesi ve eşitleme ayrı dilimlere bölünecek. Gizli bağlantı parolaları yalnızca yerel güvenli ayarda tutulacak, sohbette istenmeyecek.
