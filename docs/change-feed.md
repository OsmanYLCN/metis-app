# Merkezi değişiklik akışı — Paket 1

## Supabase’de yapılacak tek kurulum

Önkoşul: 0001–0005 zaten uygulanmış ve görev reader/writer bağlantısı çalışıyor.

1. Supabase projenin **SQL Editor** ekranına gir, **New query** aç.
2. `services/api/Database/Migrations/0006_change_feed.sql` dosyasının tamamını bu yeni sorguya kopyala. İçinde değiştirilecek parola/proje_ref yok.
3. **Run** düğmesine bir kez bas. Başarılıysa eski SQL dosyalarını yeniden çalıştırma.
4. Yerel API terminalinde `Ctrl+C`, ardından repo kökünde `npm.cmd run dev:api` çalıştır.

Bu işlem görevleri silmez, başlıkları/sürümleri değiştirmez. Mevcut görevleri (önceki silme kayıtları dahil) akışın başlangıç verisi olarak kaydeder. Transaction tamamlanmazsa kurulum geri alınır. Kurulum kısa süre görev yazmalarını bekletebilir; uygulamada gönderim yapmadığın sırada çalıştır.

Yeni hesap, parola, public key veya hosting ayarı gerekmez. Bu geliştirme sırasında canlı Supabase’e SQL uygulanmadı. 0006 henüz yoksa mevcut görev API’si çalışır; yalnızca yeni akış endpoint’i 503 verir. Uygulama şu anda bu endpoint’i otomatik çağırmıyor; arayüzde yeni bir senkronizasyon başarısı bekleme.

## API sözleşmesi (v1)

`GET /api/v1/sync/changes?limit=50&cursor=...`

- Supabase Bearer oturumu zorunlu. Hesap kimliği yalnızca doğrulanmış token’dan gelir; istemciden owner parametresi alınmaz.
- İlk istek cursor içermez. Sayfa sınırı 1–100, varsayılan 50.
- Yanıt: `contractVersion: 1`, `items`, `nextCursor`, `hasMore`.
- Her öğe: `position` (bigint hassasiyeti için ondalık string), `entity: task`, `entityId`, `revision`, `deleted`, `snapshot`.
- Snapshot görev id/title/completed/revision/createdAt/updatedAt/deletedAt alanlarını değişikliğin gerçekleştiği haliyle içerir. Eski snapshot yeni başlıkla yeniden oluşturulmaz.
- Sonraki istek sunucunun `nextCursor` değerini aynen kullanır. Boş sayfada da cursor döner; `hasMore: false` o okuma anında yetişildiğini söyler, gelecekte değişiklik olmayacağını söylemez.
- Cursor epoch, hesap ve konumu içerir. Şifre/parola/erişim yetkisi değildir; yetki her istekte tekrar doğrulanır. İstemci tahmin edilen konuma atlamamalı.
- Bozuk/başka hesaba ait cursor: 400. Başka kurulum epoch’u veya mevcut baştan ileri konum: 409 `change_cursor_reset_required`. Veritabanı/şema/yetki sorunu: 503 `change_feed_unavailable`. Yanıtlar `Cache-Control: no-store`.

## Sıra ve güvenlik

Hesap başına tek sayaç satırı transaction sonuna kadar kilitlenir. PostgreSQL sequence kullanılmaz: bir sonraki konum, önceki konumu üreten işlem commit/rollback olmadan üretilemez. Sayaç, snapshot, görev mutasyonu ve işlem makbuzu aynı transaction içindedir. Rollback sayaç artışını da geri alır; aynı operation ID’nin başarılı tekrarı yeni değişiklik üretmez. Çok kayıtlı gelecekteki transaction’lar tutarlı kilit sırası kullanmalı; deadlock/timeout durumunda aynı işlem kimliğiyle yeniden denenmeli.

Okuyucu head ve sayfayı tek repeatable-read snapshot içinde okur. Atlanan sıra tespit edilirse sessizce ileri cursor üretmez. Hesap başına aralıksız sıra beklenir; bu aşamada günlük temizleme/retention uygulanmaz. İleride retention, epoch/baseline ve cihaz acknowledgement sözleşmesiyle birlikte tasarlanmalı.

Reader yalnızca SELECT alır; writer günlük tablolarına doğrudan erişemez. AFTER trigger, sabit search_path ve kapalı EXECUTE izinleriyle migration sahibinin yetkisi altında kayıt yapar. RLS hesap ayrımını korur. Yetkili uygulama silmesi tombstone’dur; yönetici tarafından tabloya doğrudan fiziksel silme desteklenen uygulama akışı değildir.

## Henüz yapılmayanlar

Masaüstü bu akışı SQLite’a uygulamıyor; kalıcı indirme cursor’ı, iki yönlü uzlaştırma, çatışma çözümü ve recovery guard kaldırma yok. Proje/not/hedef/takvim/finans/bütçe henüz merkezi modelde değil. Ortak günlük tablosu bu modüller için genişletilecek; şu an entity kısıtı yalnızca task kabul eder. İkinci bağımsız görev tablosu oluşturulmadı.

## Yapılan doğrulama

- .NET Release solution build: sıfır hata/uyarı.
- `npm.cmd run test:change-feed`: gerçek yerel PGlite SQL + Npgsql + JWT doğrulayan HTTP hattı; eski kayıtların aktarımı, değişmez snapshot, rollback, tekrar, tombstone, RLS, sayfalar, cursor/epoch, boş kuyruk, havuzdaki hesap değişimi.
- `node scripts/test-postgres-writer.mjs`: 0006 ile mevcut görev oluşturma/düzenleme/tamamlama/silme/tekrar ve işlem makbuzları korunuyor; altı başarılı mutasyon tam altı günlük kaydı üretiyor.
- PGlite testi gerçek çok oturumlu PostgreSQL eşzamanlılık testi yerine geçmez. İki istemci ve eşzamanlı commit doğrulaması Paket 1 bitiş koşullarında duruyor.
- Canlı hesap kullanılmadı; frontend/native kod değişmediği için onların testleri ve EXE build tekrarlanmadı.
