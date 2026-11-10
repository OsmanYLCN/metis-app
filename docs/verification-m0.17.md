# M0.17 — Yerel outbox şema temeli

Doğrulama: 35 Rust depolama/oturum testi ve 63 istemci testi geçti. İlk kısıtlı çalıştırmada Windows DPAPI erişimi başarısız oldu; normal Windows izinleriyle tekrarında tüm testler geçti. Gerçek kullanıcı veritabanına migration uygulanmadı. Kaynaktan yeni sürüm çalıştırılırsa şema 3'e yükselir; eski EXE bu yeni şemayı reddeder, otomatik downgrade yoktur.

2026-11-10. Bu dilim SQLite şeması ve depolama testleriyle sınırlıdır; yeni EXE yayımlanmaz, mevcut M0.16 kullanılabilir.

Migration 0003_local_outbox, şemayı 2'den 3'e atomik olarak yükseltir. Mevcut görevler korunur; kuyruk boş başlar. Her kayıt proje, hesap, operation ID, görev ID, create/rename türü, beklenen revision ve değişmez başlık taşır. Aynı hesap/operation anahtarı ikinci kez eklenemez; payload güncellemesi trigger ile reddedilir. Kayıt sırası kalıcıdır.

Bu tablo henüz normal görev komutlarına veya IPC'ye bağlı değildir. Kuyruğa ekleme, ağ göndericisi, receipt doğrulama ve durum geçişleri sonraki dilimlerdir. Hesap sütunları tek başına yetkilendirme sağlamaz; sonraki erişim katmanı her sorguyu proje/hesap ile sınırlamalıdır. Başlık ve kimliklerin tam uygulama doğrulaması da bu katmanda yapılacaktır. SQLite şifreli değildir; kuyrukta token/parola tutulmayacaktır.

Gerçek SQLite testleri: v2 görevlerini koruyarak yükseltme; disk yeniden açılışında aynı operation/payload; duplicate ve payload değişikliği reddi; yarım kalan durum işleminin rollback'i. Mevcut depolama testleri şema 3'e güncellendi.

Sonraki küçük dilim: yalnızca yerel, hesap kapsamlı enqueue/read sözleşmesi ve görev değişikliğiyle atomik kayıt. Canlı Supabase değişikliği gerekmez.
