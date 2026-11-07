# ADR-0010 — Hesaba bağlı PostgreSQL görev okuyucusu

Durum: kabul edildi, M0.11. Canlı Supabase kurulumu bekliyor.

## Karar

Npgsql 10.0.3 ile tek uygulama veri kaynağı ve en fazla dört bağlantı kullanılır. Varsayılan sağlayıcı Disabled; yapılandırma bir veritabanı varmış gibi başarı göstermez. `/api/v1/tasks/status` gerçek ve kullanıcıya bağlı SELECT üzerinden hazır olmayı ölçer. Sağlık endpoint'i süreç kontrolü olarak kalır.

API yalnızca ayrı `metis_reader` login rolünü kabul eder. Rol süper kullanıcı, BYPASSRLS, rol/veritabanı oluşturma, replication, tablo sahipliği veya başka rol üyeliği taşıyamaz; görev yazma izni bulunamaz. Tablo RLS + FORCE RLS ve migration/proje kaydı her okuma işleminde doğrulanır. Başka Supabase projesine yanlış bağlanmayı önlemek için sunucudaki installation kaydı, yapılandırma ve JWT issuer aynı Project Ref'i kullanır.

Her okuma read-only transaction içindedir. Doğrulanmış JWT subject'inden üretilen sınırlı claim'ler parametreli `set_config(...,true)` ile yalnızca işlem ömrü boyunca ayarlanır. SQL ayrıca açık owner koşulu uygular; RLS ikinci sınırdır. Raw token veya istemcinin gönderdiği kullanıcı ID'si veritabanına taşınmaz. Havuz sıfırlama açık kalır; hesap değişiminde önceki bağlam kullanılamaz.

Bağlantı host'u ve rolü doğrulanır. Uzak bağlantı VerifyFull TLS ister; yalnızca Development + açık opt-in + 127.0.0.1 kombinasyonu sentetik testte TLS'siz çalışabilir. Connection timeout 5 saniye, SQL timeout 5 saniye ve toplam işlem iptal süresi 8 saniye; istemci iptali taşınır. Hata yanıtları bağlantı ayrıntısı veya secret içermez. [Npgsql güvenlik](https://www.npgsql.org/doc/security.html), [bağlantı ayarları](https://www.npgsql.org/doc/connection-string-parameters.html).

## Sınırlar ve doğrulama

Bu rolün parolası backend güvenlik sınırıdır; role bağlanabilen biri claim'leri kendisi ayarlayabilir. Parola masaüstüne dağıtılmaz. Yerel API ayarı User Secrets'ta repo dışında, şifrelenmeden tutulur; production barındırma ve secret yönetimi ayrı dilimdir.

PGlite + pglite-socket yalnızca geliştirme testinde gerçek PostgreSQL sorgu/izin motorunu TCP üzerinden Npgsql'e bağlar. Sentetik auth yardımcıları ve üretilmiş JWT/JWKS kullanılır. Socket köprüsü tek PostgreSQL backend'ini paylaşır; gerçek çoklu PostgreSQL oturumları, Supavisor, parola doğrulaması ve TLS bu testle kanıtlanmaz. [PGlite socket sınırları](https://pglite.dev/docs/pglite-socket).

Migration 0002 rolü parolasız ve installation kaydı olmadan oluşturur: yönetici bunları tamamlamadan API hazır sayılmaz. Migration otomatik uygulanmaz. Merkezi yazma, sync, çatışma çözümü ve masaüstünde merkezi okuma sonraki onaylı dilimlerdir.
