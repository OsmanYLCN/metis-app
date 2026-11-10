# M0.19 — Bekleyen kayıt uzlaştırması ve arayüz

2026-11-11. Yerel create kuyruğu başlık düzenlenirken atomik olarak yeni operation ID ve yeni başlıkla değiştirilir. Aynı düzenleme tekrarında kimlik korunur. Silmede pending kayıt aynı transaction içinde kaldırılır. Pending olmayan işlem varsa rename/delete çatışmayla reddedilir. Bu yaklaşım henüz hiçbir ağ göndericisi bulunmamasına dayanır; gönderici eklenirken in-flight/receipt durumu tasarlanmalıdır.

Görev ekranı yalnızca açık hesabın bekleyen kayıt sayısını dar kapsamlı outbox_count IPC üzerinden gösterir. Sayı alınamazsa sahte sıfır gösterilmez. Hesap değişiminde geç yanıtlar bırakılır. Tamamlama hâlâ yereldir; kuyruk create snapshotları gönderime hazır değildir. Önceki görevler otomatik kuyruğa alınmaz.

38 Rust testi: yeniden adlandırma, tekrar deneme, silme, hesap ayrımı ve hata enjekte edilmiş rollback dahil. TypeScript/Vite üretim derlemesi başarılı. Windows çıktısı outputs/Metis-M0.19.exe.

63 istemci testi geçti. Windows Release derlemesi başarılı; henüz göndericiye bağlanmayan pending okuma fonksiyonu ve modeli için iki dead-code uyarısı var. Arayüzün yeni sayacı gerçek Windows penceresinde otomatik olarak sınanmadı. Paket sürüm alanı v0.13.0 olarak kaldı; teslim dosyası M0.19 adını taşır.

Bu EXE ilk açılışta SQLite şemasını 3'e yükseltir; eski M0.16 EXE yükseltilmiş DB'yi açamaz. Kayıtlar korunur, otomatik downgrade yoktur. Supabase işlemi veya otomatik gönderim yapılmadı.
