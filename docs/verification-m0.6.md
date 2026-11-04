# M0.6 — Windows oturum kasasının ilk dilimi

4 Kasım 2026 · Metis 0.6.0

- Yeni native dosya: `apps/desktop/src-tauri/src/session_vault.rs`.
- Windows kullanıcısına ve projeye bağlı DPAPI şifreleme; şifreli disk kaydı, okuma, replace ve silme.
- Bellek temizliği, genel hata türleri, boyut/sürüm sınırları ve bozuk kaydı koruma.
- ADR-0006 ve sürüm dosyaları güncellendi. Yeni bağımlılık indirilmedi.

## Gerçek sonuçlar

`cargo test --release --locked`: **23/23 geçti**. 12 mevcut SQLite testi, 11 vault test girdisi (bir tanesi ayrı süreç için yardımcı test). Ek çocuk süreç okuması da geçti. Gerçek DPAPI ve disk kullanıldı; yalnızca sentetik test sırrı üretildi, gerçek hesap/token kullanılmadı. İlk 20 testlik çalışma da geçti; ayrı süreç ve payload sürümü testleri eklendikten sonra güncel 23 test tekrar çalıştırıldı.

Giriş UI'ı/API iş mantığı değiştirilmedi; önceki istemci/API/UI testleri bu dilimde tekrar edilmedi. Canlı Supabase ayarı `.env.local` hâlâ yok; gerçek giriş veya token yenileme denenmedi.

## Durma noktası

TypeScript/Vite üretim derlemesi ve Tauri Windows x64 Release derlemesi başarılı. `outputs/Metis-M0.6.exe` bağlantı ayarları boş önizlemedir; önceki giriş davranışı korunur. Kaynak ZIP gerçek yerel ayarları, bağımlılıkları, veri dosyalarını ve build çıktılarını içermez.

Bu teslim saklama adaptörüdür; giriş akışına/IPC'ye henüz bağlanmamıştır. Normal kullanımda refresh token kaydedilmez ve kalıcı giriş açılmaz. Sonraki küçük dilim: açık kullanıcı seçimiyle cihazda oturum saklama, native komut sınırı ve yenilemenin ilk entegrasyonu. Gerçek bağlantı ayarları için mevcut `supabase-local-setup.md` geçerlidir.

Commit/push yapılmadı. Yeni servis veya deploy yok.

Commit: `feat: add Windows DPAPI session vault foundation`
