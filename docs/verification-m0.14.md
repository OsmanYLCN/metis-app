# M0.14 — Atomik PostgreSQL görev writer temeli

2026-11-08. Sunucu/SQL dilimidir; masaüstü sürümü **0.12.0** olarak kalır ve yeni EXE üretilmedi.

## Oluşan parçalar

- `0003_task_writer.sql`: ayrı `metis_writer` login rolü, FORCE RLS işlem günlüğü, dar sütun izinleri ve atomik `apply_task_write` fonksiyonu.
- `PostgresTaskWriter.cs`: rol/izin/RLS/migration/proje korumaları, transaction-local hesap claim'i, parametreli create/rename çağrısı ve güvenli hata sınırı.
- `PostgresWriterChecks.cs` ve `test-postgres-writer.mjs`: gerçek Npgsql TCP bağlantısıyla izole PostgreSQL entegrasyonu.
- `npm run test:postgres-writer`: tekrarlanabilir derleme + entegrasyon komutu.

## Doğrulama

- .NET Release solution: **0 uyarı, 0 hata**.
- API/JWT/karar + writer paketi: **49 kontrol geçti**. Writer grubu create, aynı işlemin replay'i, farklı içerikle operation çatışması, rename, eski revision, başka hesap RLS, iptal ve DELETE reddini kapsar.
- Test sonunda veritabanı yeniden açıldı: görev başlığı `Renamed cloud task`, revision 2 ve başarılı işlemlere ait tam 2 receipt doğrulandı.
- Mevcut ayrı API süreci smoke: **6/6** geçti; HTTP yazma uçlarının hâlâ kapalı olduğu doğrulandı.
- Mevcut şema/RLS paketi: **8/8** geçti.
- İlk sandbox derlemesi proje çıktı klasörüne yazma izni olmadığı için başlayamadı; aynı test gerekli çalışma izniyle yürütüldü. İlk kod derlemesindeki Npgsql constructor hataları düzeltildi. Ardından writer reddi güvenli SQLSTATE teşhisiyle `SELECT FOR UPDATE` yetkisine bağlandı; aynı operation için transaction advisory lock kullanılarak gereksiz journal UPDATE yetkisi verilmeden çözüldü. Tüm paket son haliyle yeniden geçti.

## Gerçeklik ve kapsam sınırı

Migration yalnızca izole yerel PostgreSQL motoruna uygulandı. **Canlı Supabase'e uygulanmadı**, writer parolası oluşturulmadı, User Secrets değiştirilmedi ve gerçek görev verisi yazılmadı. `PostgresTaskWriter` henüz dependency injection'a veya HTTP endpoint'e bağlı değildir; uygulama üzerinden merkezi yazma yapılamaz. Reader rolünün izinleri değişmedi.

PGlite PostgreSQL izin/RLS/transaction motorunu çalıştırır ve Npgsql socket bağlantısı gerçektir. Socket testi gerçek çoklu Supavisor oturumu, TLS veya eşzamanlı yük testi değildir. Canlı kurulum, endpoint ve masaüstü yükleme ayrı onaylı dilimlerdir.

Çıktılar: `outputs/Metis-M0.14-source.zip`, `outputs/M0.14-Dogrulama.md`. Sonraki küçük adım: writer için ayrı yerel secret yapılandırması ve create/rename HTTP sözleşmesi; kullanıcı onayı olmadan devam edilmez.
