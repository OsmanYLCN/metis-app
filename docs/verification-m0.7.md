# M0.7 doğrulama — hatırlanan cihaz oturumu

4 Kasım 2026 · 0.7.0

Tamamlananlar: opt-in hatırla seçeneği; native kasa komutları ve dar izinler; açılışta geri yükleme; refresh rotasyonu + API doğrulaması; çıkış/iptal yarışlarının kontrolü; hata ve silme tekrar denemesi.

| Kontrol | Sonuç |
| --- | --- |
| Vitest | **50/50** geçti; 12 yeni kalıcı oturum senaryosu dahil |
| Rust native testleri | **24/24** geçti; gerçek DPAPI ve paylaşılmayan Windows handle testi dahil |
| Edge giriş UI | **3/3** geçti; yeni opt-in/reload/rotasyon/çıkış senaryosu, tüm sağlayıcı yanıtları ve bu testte kasa köprüsü mock |
| Gerçek Windows/WebView2 IPC | Kasa yaz/oku, proje ayrımı, süreç yeniden başlatıldıktan sonra oku/sil, genel filesystem izninin reddi ve SQLite kimliğinin korunması geçti |
| TypeScript/Vite + Tauri Release | Windows EXE üretildi |

İlk TypeScript kontrolü yeni testte mock fonksiyon tipini reddetti; açık fonksiyon türüyle düzeltildi ve sonraki production build geçti. İlk native smoke koşusunun kontrolleri geçti ancak kapanış betiği zaten SIGTERM ile sonlanmış süreci tekrar bekledi. `signalCode` kontrolü eklendi, yalnızca o testin süreçleri temizlendi; yeniden çalıştırma **exit 0** ile tamamlandı.

Supabase'e gerçek istek yapılmadı; `.env.local` yok. Test kullanıcıları ve tokenlar sentetiktir. API iş mantığı değişmedi; 31 API testinin önceki sonucu yeni koşu gibi sunulmaz. Gerçek sağlayıcının refresh/CORS davranışı, gerçek hesap izinleri ve gerçek proje CSP kontrolü canlı bağlantı kurulunca doğrulanacak.

Yeni ana dosyalar: `identity/vault.ts`, `identity/remember.test.ts`, ADR-0007. Güncellenenler: giriş store'u/formu, Tauri host/kasa/izin manifestleri, native ve UI testleri, sürüm dosyaları. Ayrıntılı davranış ve hata sınırları ADR-0007'de.

Bu dilimde duruldu. Sonraki onayda canlı hesap bağlantı kontrolü yapılabilir; Supabase hazırlığı gecikirse sıradaki yerel veri/iş akışı dilimi ayrıca belirlenir. Yeni ücretli servis, deploy, commit veya push yapılmadı.

Commit: `feat: add encrypted remembered sessions and token renewal`
