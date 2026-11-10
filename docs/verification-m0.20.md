# M0.20 — Kalıcı gönderim niyeti ve receipt doğrulama

2026-11-11. İki parça birlikte eklendi: gönderimden önce diske kalıcı niyet kaydı ve başarılı HTTP yanıtından sonra hesap/operation/görev/revision eşleşmesiyle atomik yerel onay.

SQLite migration 0004, outbox_delivery tablosunu ekler (şema 4). Gönderim niyeti alınmış create kaydı silinemez veya başlığı değiştirilerek yeni operation'a dönüştürülemez. Tamamlama da bu aşamada çatışmayla durur. Bağlantı kaybında niyet geri alınmaz; yeniden açılan DB aynı operation ve payloadı döndürür. Paralel tekrarlar aynı kimliği kullanır; HTTP tarafında mevcut idempotency sözleşmesine dayanır, tek çalışan kilidi iddiası yoktur.

Yalnızca mevcut, açık, aynı başlığa sahip yerel create snapshotları gönderime hazırlanabilir. Onay yalnızca applied/replayed, doğru görev/operation/hesap ve revision 1 ile kabul edilir. Yerel onay tekrar edilebilir; task_outbox durumu ve receipt revision aynı transaction içinde yazılır.

40 Rust ve 63 istemci testi geçti. Gerçek SQLite yeniden açılışı, yanlış hesap/görev/revision, erken onay, tekrar onay, niyet sonrası rename/delete/complete reddi ve tamamlanmış görev engeli test edildi.

Bu fonksiyonlar henüz IPC veya HTTP istemcisine açılmadı. Canlı görev gönderilmedi; kullanıcının veritabanı değiştirilmedi. M0.19 EXE kullanılmaya devam edilir; bu dilimde yeni EXE yoktur. Kaynaktan çalıştırma şema 4'e yükseltir ve eski EXE geri dönüşü desteklenmez.

Sonraki birleşik dilim: kullanıcı tarafından seçilen tek görevin gönderim arayüzü, oturum kapsamlı HTTP çağrısı ve bu yerel niyet/onay katmanına bağlantı. Gönderim sonrası rename/complete/delete desteği ayrıca tasarlanmalıdır; bu işlemler hazır olana kadar teslim edilmiş görevlerde kapalı kalacaktır.
