# M0.22 — Gönderim durumu ve bulut başlığı

2026-11-13. Bu dilim, M0.21'deki açık görev gönderimini görünür ve devam ettirilebilir hale getirir. Görev satırı artık `Gönderim bekliyor`, `Değişiklik bekliyor`, `Bulutta` veya `Yalnızca bu cihazda` durumunu gösterir. Buluta ulaşmış görevde ikinci kez oluşturma önerilmez.

Buluta gönderilmiş açık bir görevin başlığı değiştirildiğinde SQLite aynı işlemde yeni, değişmez bir `rename` kaydı oluşturur. Kullanıcı **Değişikliği gönder** düğmesine bastığında Rust gönderim niyetini kalıcılaştırır; masaüstü istemcisi mevcut oturum tokenıyla API'nin `PATCH /api/v1/tasks/{id}` ucuna kayıtlı işlem kimliği ve beklenen revision'ı yollar. Yanıt kaybolursa aynı işlem yeniden denenir. Yalnızca eşleşen task ID, outcome ve revision yerel receipt olarak kabul edilir. Bir sonraki başlık değişikliği, önceki gönderim onaylanana kadar bekler. Buluttaki görevin tamamlama ve silmesi hâlâ kapalıdır.

SQLite şema sürümü **4** olarak kaldı; migration veya canlı Supabase SQL adımı yok. API'nin mevcut create/rename sözleşmesi kullanılır. Otomatik gönderim, çift yönlü eşitleme ve çatışma çözümü yoktur. Bulut sürümü değişmişse yerel başlık korunur ve açık hata gösterilir; istemci sessizce üzerine yazmaz. Eski, outbox kaydı olmayan görevler yalnızca bu cihazda kalır.

## Doğrulama

- TypeScript/Vite üretim derlemesi geçti; 70 istemci testi geçti.
- 29 yerel SQLite/Rust testi geçti. Bunlardan biri gönderilmiş görevin revision 1→2 başlık akışını, tekrar gönderme kimliğini ve hesap ayrımını doğruluyor.
- Windows Release EXE derlendi. Ayrı geçici veri dizini ve mock API ile native smoke testi geçti: IPC görev akışı, yeniden açma, hesap ayrımı, oturum kasası ve SQLite kalıcılığı.
- Tam Rust test çalışmasında 40 testin 34'ü geçti; 6 DPAPI kasa testi bu kısıtlı çalıştırma ortamında `Unavailable` döndürdü. Native smoke testindeki gerçek Windows kasa aç/kaydet/sil akışı geçti.
- Canlı kullanıcı hesabıyla gerçek başlık gönderimi bu ortamda yapılmadı. Bu kontrol için kullanıcı sentetik bir görev oluşturup önce **Buluta gönder**, sonra başlığını değiştirip **Değişikliği gönder** eylemlerini deneyebilir. Yerel API ayrı süreç olarak açık olmalı. Parola veya token sohbete gönderilmez.

Sonraki dilim adayı: buluttaki görevler için tamamlama/silme sözleşmesi ve çatışma çözümü. Kullanıcı onayı olmadan başlatılmaz.
