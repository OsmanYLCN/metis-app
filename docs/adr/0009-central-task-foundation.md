# ADR-0009: Merkezi görev modeli ve okuma erişim sınırı

Durum: Kabul edildi — M0.10, 2026-11-07.

## Bu dilimin kararı

ASP.NET Core modüler monolit içinde `Modules/Tasks` oluşturuldu. İlk merkezi dilim veri modeli, kimlik doğrulama/okuma sözleşmesi ve PostgreSQL erişim kurallarıdır. Masaüstü mevcut SQLite akışını kullanır. PostgreSQL bağlantı adaptörü, merkezi yazma endpoint'leri, yerel kayıtların taşınması ve eşitleme bu dilimde yoktur.

Üretim kaydı `UnconfiguredTaskReader` kullanır; bellek tabanlı veya sahte başarılı depolama yoktur. Kimliği doğrulanmış okuma isteği `503 central_store_not_configured` alır. Test fixture reader yalnızca test projesindedir. Bir sonraki bağlantı dilimi aynı `ITaskReader` arayüzünü gerçek PostgreSQL ile uygular; bu sınıfın adı “configured” olduğu için çalışan bağlantı varsayılmaz.

## Sahiplik ve endpoint'ler

`GET /api/v1/tasks/status`, `GET /api/v1/tasks` ve `GET /api/v1/tasks/{id}` yalnızca mevcut Supabase Bearer doğrulamasıyla açılır. Filter, named scheme'i açıkça doğrular; önceden atanmış `HttpContext.User`, header veya query'deki kullanıcı kimliğine güvenmez. Doğrulanan `sub` her repository çağrısında zorunlu parametredir. Yetkisiz istek repository'ye ulaşmadan 401 alır. Yanıtlar `no-store` kullanır.

Merkezi veritabanı tek yapılandırılmış Supabase projesine aittir. API zaten tek issuer kabul eder; farklı projelerin kullanıcı UUID'leri ortak bir veritabanına karıştırılmaz. Gelecekte çok projeli model istenirse issuer/tenant anahtarı ayrıca tasarlanmalıdır.

Görev yanıtı kullanıcı kimliği taşımaz. Başka hesaba ait, silinmiş ve bulunmayan görev aynı 404 yanıtını verir. Repository yanlış sahipli veya silinmiş kayıt döndürürse endpoint bunu sızdırmaz; liste fail-closed 503, detay 404 olur. Bilinmeyen sorgu alanları, kullanıcı override'ları, yinelenen alanlar ve bozuk cursor reddedilir.

Liste `limit` (varsayılan 50, 1–100) ve `after` (32 hex UUID) kullanır. Sıra UUID artandır; bir fazla kayıt okunarak `nextCursor` üretilir. Bu cursor bir sync watermark değildir; araya eklenen daha küçük UUID'nin sonraki sayfada görünmesi garanti edilmez. Masaüstünün mevcut yerel oluşturulma zamanı sıralaması değişmez. Snapshot veya değişiklik akışı daha sonra tasarlanacak.

## PostgreSQL modeli

`services/api/Database/Migrations/0001_central_tasks.sql` tek transaction içinde özel `metis` şemasını, migration günlüğünü ve görev tablosunu oluşturur. Yeniden çalıştırma mevcut şemada hata verir; nesneleri silmez veya sessizce yeniden sahiplenmez. Canlı ortamda çalıştırılmadı, uygulama başlangıcında otomatik uygulanmaz.

- Anahtar: `(user_id, id)`; `user_id`, `auth.users(id)` yabancı anahtarıdır. Auth kullanıcısı silinirse görevleri de silinir.
- Yerel 32 hex kimlikler UUID'ye kayıpsız dönüştürülebilir. API aynı 32 hex biçimi döndürür. Taşıma işlemi henüz yoktur.
- Başlık, tamamlanma durumu, sunucu revision'ı, oluşturulma/güncellenme ve silinme zamanı vardır.
- Trigger, oluşturma zamanını/revision'ı sunucudan üretir; güncellemede revision artırır, kimlik/sahip değişimini reddeder. Silinme kaydını tekrar aktif hale getirmez.
- Satır sürümü gelecekte optimistic concurrency içindir; global/commit sıralı sync cursor değildir. Tekrar deneme/idempotency, conflict ve tombstone saklama süresi ayrıca belirlenecek.

`ENABLE` + `FORCE ROW LEVEL SECURITY` kullanılır. `authenticated` rolüne yalnızca şema kullanımı ve görev SELECT yetkisi verilir. Okuma politikası `auth.uid()` eşleşmesini, `is_anonymous=false` bilgisini ve silinmemiş kaydı şart koşar. `anon`, `service_role`, PUBLIC için görev/migration erişimi verilmez. INSERT/UPDATE/DELETE istemci yetkisi ve politikası bu dilimde açılmaz. Özel şema Data API'ye expose edilmez.

RLS, superuser veya BYPASSRLS yetkili role karşı koruma sağlamaz. Gelecek .NET adaptörü en az yetkili rol, transaction'a özgü doğrulanmış hesap bağlamı ve ayrıca SQL sahiplik filtresi kullanmalıdır. `postgres`/service role erişimini güvenlik garantisi saymak veya istemci kimliğini SQL bağlamı yapmak kabul edilmez.

## Doğrulama sınırı ve maliyet

JWT/HTTP testleri gerçek imza doğrulaması, geçici RSA/EC anahtarları ve sahte JWKS taşıması kullanır. Görev reader fixture'ı yalnızca test içindedir. SQL/RLS testleri PGlite'ın yerel PostgreSQL motorunda çalışır; Supabase'in yönettiği auth şeması/rolleri/claim yardımcıları sentetik fixture'dır. Canlı Supabase izinleri, TCP bağlantısı, pooling ve gerçek migration uygulaması doğrulanmış sayılmaz.

PGlite yalnızca sabitlenmiş geliştirme/test bağımlılığıdır; masaüstüne veya API çalışma zamanına eklenmez. Yeni servis, hesap, ücret veya deploy yoktur.

Kaynaklar: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [PGlite test motoru](https://pglite.dev/docs/).
