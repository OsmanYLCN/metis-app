# M0.18 — Kuyruk erişimi ve atomik görev oluşturma

2026-11-10. İki bağlı iş birlikte tamamlandı: Rust içinde hesap/proje kapsamlı, cursor ile 100 kayıtlık kuyruk okuma; yeni yerel görevle create işlem kaydının aynı SQLite transaction'ında oluşturulması.

Görev ID'si create operation ID'sidir; aynı oluşturma isteğinin tekrarı tek görev ve tek kuyruk kaydı bırakır. Önceden var olan görevler kuyruğa alınmaz. Kuyruk INSERT başarısız olursa görev INSERT de geri alınır. Sıfır UUID reddedilir. Hesap kapsamı yerel veri ayrımıdır, aynı Windows kullanıcısına karşı güvenlik sınırı değildir.

Kuyruk henüz gönderime hazır değildir: rename/tamamlama/silme yerel işlemleri create snapshotını değiştirmez. Ağ göndericisi eklenmeden önce bu değişiklikler ve silinmiş görevler uzlaştırılmalıdır. Pending listesinin doğrudan buluta gönderilmesi desteklenmez. IPC ve arayüzde kuyruk erişimi açılmadı; Rust erişim katmanı hazırdır. Normal görev komutunun kaynak kodu yeni create kaydını atomik ekler.

Gerçek SQLite testleri: başarısız enqueue için tam rollback; aynı isteğin tekrarında tek kayıt; hesap/proje ayrımı; kalıcı kimlik; 100+3 kayıt cursor sırası. Kullanıcı verileri veya Supabase değiştirilmedi. Yeni EXE yayımlanmadı; M0.16 kullanılabilir. Kaynaktan çalıştırıldığında şema 3'e yükselen DB eski EXE ile açılamaz.

Sonraki birleşik dilim: yerel düzenleme/silme uzlaştırması ve kuyruk durumunun arayüzde gösterilmesi. Ardından kullanıcı kontrollü gönderim.
