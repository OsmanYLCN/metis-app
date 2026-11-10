# M0.21 — Seçili yerel görevi buluta gönderme

2026-11-11. Masaüstü v0.14.0, görev satırına kullanıcı eylemiyle çalışan **Buluta gönder** düğmesi ekler. Seçilen görev için aynı hesap/proje ve görev ID'sindeki pending create bulunur; Rust önce kalıcı gönderim niyetini yazar, sonra token yalnızca LoginStore içinde tutularak doğrulanmış API'ye POST yapılır. Yanıtın durum, outcome, görev ID ve revision değeri doğrulandıktan sonra yerel receipt atomik olarak kaydedilir. Yanıt kaybında aynı operation ID ile tekrar deneme yapılır.

Eski görevler, tamamlanmış görevler, değişmiş payload ve gönderim sırasında farklı hesaba geçiş güvenli biçimde reddedilir. Düğme normal görev satırlarında görünür; bekleyen kaydı olmayan görev için açıklayıcı hata çıkar. Otomatik gönderim ve çift yönlü sync yoktur. Gönderilmiş görevlerin rename/complete/delete işlemleri bu sürümde çatışmayla kapanır; sonraki dilimde uzaktan yazma sözleşmesi genişletilecektir.

40 Rust, 65 istemci testi geçti. TypeScript/Vite ve Windows Release derlemesi başarılı. Native arayüzde canlı kullanıcı görevi gönderimi henüz kullanıcı tarafından doğrulanmadı. API ayrı süreç olarak açık olmalıdır. Bu sürüm SQLite şema 4'e yükseltir; önceki EXE'ye aynı veritabanıyla dönülmez.
