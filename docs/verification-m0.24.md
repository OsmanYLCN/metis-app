# M0.24 — Bekleyen görevleri gönderme

Metis, açık oturumda görev ekranı açıldığında ve yeni görev/başlık kaydedildiğinde gönderime uygun yerel işlemleri sırayla buluta gönderir. **Şimdi buluta gönder** düğmesi aynı kuyruğu elle çalıştırır. Oluşturma, başlık değişikliği, tamamlama, yeniden açma ve silme işlemleri önceki dilimlerin kalıcı işlem kimliklerini kullanır. Ağ yanıtı kaybolursa kayıt cihazda kalır ve sonraki denemede aynı işlem yeniden gönderilir.

İlk otomatik deneme kısa bir zaman sınırına ve en çok 20 işleme sahiptir; elle deneme en çok 100 işlem yapar. Hata sonrası otomatik deneme durur ve kullanıcı düğmeyle yeniden başlatabilir. Henüz buluta gönderilmeden tamamlanan yerel görev önce bulutta oluşturulur, ardından aynı sıra içinde tamamlanır. İşlemler yalnızca açık hesabın kuyruğundan okunur. Buluttan görev indirme veya başka cihazdaki değişiklikleri birleştirme henüz yoktur.

## Kullanım

1. Eski Metis pencerelerini kapat ve [`outputs/Metis-M0.24.exe`](../outputs/Metis-M0.24.exe) dosyasını aç.
2. Yerel API'yi `npm.cmd run dev:api` ile açık tut ve hesabına giriş yap.
3. **Görevler** ekranına gir. Bekleyen işlemler gönderilir; sonuç ve kalan sayı ekranda görünür.
4. Bağlantı hatasında **Şimdi buluta gönder** ile tekrar dene. Görevleri cihazdan silme.

Önceki dilimin Supabase [`0005_task_writer_lifecycle.sql`](../services/api/Database/Migrations/0005_task_writer_lifecycle.sql) değişikliği hâlâ gereklidir. Yeni bir SQL veya gizli anahtar adımı eklenmedi.

## Doğrulama

- `npm.cmd run build`: TypeScript/Vite geçti.
- `npm.cmd run test`: 75 test geçti; sıralı gönderim, belirsiz yanıt ve iptal dahil.
- Rust SQLite depolama testleri: hesap ayrımı, önceden tamamlanan göreve ikinci bulut işlemini tek kez kuyruğa alma dahil.
- Görev ekranı tarayıcı testleri: 3 senaryo geçti; sahte IPC ve Auth kullanır.
- Windows EXE ve gerçek SQLite açılış testi: `npm.cmd run test:native`.

Canlı Supabase hesabıyla bu dilimin otomatik gönderimi henüz doğrulanmadı. Sonraki dilimde buluttan güvenli indirme, cihazlar arası değişiklik ve çatışma yönetimi ele alınacak.
