# Merkezi veritabanı temeli

M0.10 yalnızca PostgreSQL/Supabase SQL modelini ve okuma erişim sınırını hazırlar. **Bu SQL henüz canlı Supabase projesine uygulanmadı.** Yerel SQLite migration'larıyla aynı runner veya sürüm numarası kullanılmaz.

`Migrations/0001_central_tasks.sql`, mevcut Supabase `auth.users`, `auth.uid()`, `auth.jwt()` ve standart rollerini bekler. Özel `metis` şeması içinde atomik olarak tablo/izin/trigger oluşturur. Uygulama açılışında çalışmaz; tekrar çalıştırmak mevcut şema üzerinde hata verir ve transaction geri alınmalıdır. Veri sıfırlayan drop/recreate yolu yoktur.

Bu dilimde gerçek DB bağlantısı, bağlantı parolası veya migration runner eklenmedi. Sonraki bağlantı diliminde önce ayrı test veritabanı, en az yetkili API rolü ve transaction hesap bağlamı doğrulanacaktır. `metis` şemasını Supabase Data API exposed schemas listesine eklemek gerekmez. Service-role/secret key masaüstüne konmaz.

Test:

```powershell
npm.cmd run test:tasks-schema
```

Test PostgreSQL motorunu yerelde bellekte çalıştırır; yalnızca sentetik hesaplar kullanır. Mevcut Supabase projesine bağlanmaz. İşletim sistemine PostgreSQL servisi kurmaz.

Karar ve sınırlar: [ADR-0009](../../../docs/adr/0009-central-task-foundation.md).
