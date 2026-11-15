# M0.23 — Bulut görevini tamamlama ve silme

Bu dilimde buluta gönderilmiş görevler tamamlanabilir, yeniden açılabilir ve silinebilir. Her işlem önce cihazdaki SQLite kuyruğuna yazılır. Ağ yanıtı kaybolursa **İşlemi tekrar dene** aynı işlem kimliğini kullanır; başarılı yanıt yerel kayıt ve kuyruk durumunu birlikte günceller. Kullanıcı açıkça tıklamadıkça gönderim yapılmaz. Otomatik veya çift yönlü eşitleme henüz yoktur.

## Kullanıcının yapacağı tek kurulum adımı

Canlı Supabase projesinde **SQL Editor → New query** aç. [`0005_task_writer_lifecycle.sql`](../services/api/Database/Migrations/0005_task_writer_lifecycle.sql) dosyasının **tamamını** editöre yapıştırıp **Run** seç. İşlem başarılıysa yerel API terminalini kapatıp yeniden `npm.cmd run dev:api` ile başlat. SQL'i bir kez çalıştır; şema zaten 5 ise tekrar çalıştırma. Yeni parola, anahtar veya bağlantı ayarı gerekmiyor. Bu adımı yapmadan önce bulut tamamlama/silme düğmeleri kullanılmamalı; API eski veritabanı sürümünü güvenli biçimde reddeder.

Ardından eski Metis pencerelerini kapat ve [`outputs/Metis-M0.23.exe`](../outputs/Metis-M0.23.exe) dosyasını aç. Mevcut yerel görevler korunarak SQLite şema 5'e yükselir. Buluta gönderilmiş bir görevde onay kutusu tamamla/yeniden aç, çöp kutusu sil işlemini başlatır. Ağ hatasında görev cihazda kalır; tekrar dene düğmesini kullan.

## Doğrulama

- `npm.cmd run build`: TypeScript ve Vite geçti.
- `npm.cmd run test`: 72 test geçti; yeni HTTP yaşam döngüsü yanıt testleri dahil.
- `npm.cmd run test:identity`: 57 kontrol geçti; doğrulanmış hesap, yeni endpoint eşlemeleri ve hatalı istekler dahil.
- `npm.cmd run test:login-ui -- tests/login-ui/tasks.spec.ts`: 3 görev ekranı senaryosu geçti; silme sonrası klavye odağı dahil.
- `npm.cmd run test:postgres-writer`: izole PostgreSQL motorunda oluşturma, başlık, tamamlama, yeniden açma, tombstone, tekrar gönderim, RLS ve HTTP adaptörü geçti. Gerçek Supabase hesabı kullanılmadı.
- `cargo test --release --locked --manifest-path apps/desktop/src-tauri/Cargo.toml storage::tests`: yerel SQLite kontrolleri geçti; işlem kimliğinin yeniden açılışta korunması, hesap ayrımı ve silme dahil.
- `npm.cmd run build:desktop`: Windows EXE üretildi.
- `METIS_NATIVE_MOCK_API=1 npm.cmd run test:native`: gerçek EXE ve SQLite yeniden açılış kontrolü geçti; API yanıtı mock.

Canlı Supabase SQL değişikliği bu çalışma sırasında uygulanmadı. Bu yüzden kullanıcının hesabıyla tamamla/sil uçtan uca canlı testi henüz yapılmadı. Sonraki geliştirme dilimi otomatik eşitleme ve çatışma çözümüdür.
