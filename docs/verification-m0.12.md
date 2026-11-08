# M0.12 — Açık oturumla merkezi okuma kontrolü

2026-11-08, sürüm 0.12.0.

Genel bakış ekranına **Bulut bağlantısı** kartı eklendi. Kullanıcı düğmeye bastığında mevcut oturumun Bearer tokenıyla önce `/api/v1/tasks/status`, ardından `/api/v1/tasks?limit=1` okunur. Başarı yalnızca iki yanıt da doğrulanırsa gösterilir. Boş bulut alanı ayrı açıklanır. Görev başlıkları gösterilmez, SQLite'a kopyalanmaz; merkezi yazma ve sync yoktur.

Token yalnızca LoginStore içinde kullanılır; React state'ine, URL'ye veya log'a çıkarılmaz. İstekler GET, no-store, credentials omit ve redirect error kullanır; toplam süre sınırı 20 saniyedir. Oturum değişikliği/süre sonu ve iptal sonrası yanıt reddedilir. Kart çıkışta veya token yenilemede yeniden oluşturulur; önceki sonuç korunmaz.

## Doğrulama

- Vitest **60/60** geçti; 6 yeni kontrol: oturumsuz erişim, doğru Bearer/sınırlı okuma, hazır olmayan bağlantı, çıkış sonrası geç yanıt, bozuk liste, güvenli hata mesajları.
- Edge Playwright **7/7** geçti. Yeni senaryo giriş, boş bulut alanında başarı, bağlantı kesintisi ve çıkışta temizliği doğrular. Auth ve merkezi API yanıtları bu UI testlerinde mock'tur.
- TypeScript/Vite üretim ve Tauri Windows Release derlemesi alındı.
- Gerçek kullanıcının açık oturumuyla canlı uçtan uca sonuç henüz gözlenmedi. Önceki dilimde canlı TLS bağlantısı ve üretim reader'ı sentetik hesap ID'siyle doğrulandı; bu iki doğrulama birbirinden ayrıdır.

## Kullanım

API terminali açık kalsın. Önceki uygulamayı kapatıp `outputs/Metis-M0.12.exe` aç. Hesabına giriş yap veya kayıtlı oturumunu aç. Genel bakışta aşağıdaki **Bulut bağlantısı → Bulut okumasını kontrol et** düğmesine bas. Beklenen mesaj: **Bulut okuması doğrulandı.** Bulut alanının boş olması yerel görevlerinin silindiği anlamına gelmez.

Kullanıcı bu sonucu doğruladıktan sonra merkezi yazma/çatışma sözleşmesinin ilk dilimi ayrıca onaylanacak. Bu çalışmada gerçek görev veya hesap verisi değiştirilmedi; yeni servis açılmadı.
