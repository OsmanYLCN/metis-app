# M0.25 — Notlar ve Projeler

Bu dilimde iki gerçek ürün ekranı açıldı. **Notlar:** başlık ve çok satırlı içerik, arama, sabitleme, düzenleme ve silme. **Projeler:** ad, açıklama, aktif/beklemede/tamamlandı durumu, arama, düzenleme ve silme. Ana ekrandan iki alana kısa bağlantı bulunur. Kaydedilmemiş düzenlemeyle başka bölüme geçerken uyarı gösterilir.

Kayıtlar Windows cihazındaki mevcut SQLite dosyasında ve giriş yapılan hesaba ayrılmış alanda tutulur. Şema 5'ten 6'ya otomatik yükselir; önceki görevler korunur. Notlar ve projeler **henüz Supabase'e gönderilmez**. Bu alanları başka cihazda veya uygulamayı kaldırdıktan sonra geri getirme garantisi yoktur. Tarayıcı önizlemesi kayıt tutmaz.

## Kullanım

1. Eski Metis pencerelerini kapat, [`outputs/Metis-M0.25.exe`](../outputs/Metis-M0.25.exe) dosyasını aç ve hesabına giriş yap.
2. Sol menüden **Notlar** veya **Projeler** seç. **Yeni not / Yeni proje** ile kayıt oluştur, **Kaydet** seç.
3. Listeden kaydı açıp düzenle. Silme işlemi ayrıca onay ister. Arama başlık ve içerikte çalışır.

Bu dilim için Supabase SQL, anahtar, parola veya yeni servis kurulumu gerekmiyor.

M0.24 paketinin yerel toplu görev kuyruğu komutları Windows izin listesinde eksikti. M0.25 bu izinleri tamamlar; yeni EXE görev kuyruğu komutlarıyla birlikte not ve proje işlemlerini de açar. Önceki EXE yerine bu sürümü kullan.

## Doğrulama

- `npm.cmd run build`: TypeScript ve Vite.
- `npm.cmd run test`: masaüstü istemci testleri.
- `cargo test --release --locked --manifest-path apps/desktop/src-tauri/Cargo.toml storage::tests`: gerçek SQLite, yükseltme, yeniden açılış, hesap ayrımı, tekrar deneme ve revizyon çatışmaları.
- `npm.cmd run test:login-ui -- tests/login-ui/workspace.spec.ts`: not ve proje ekranları, arama, düzenleme, silme, koyu tema ve kaydedilmemiş değişiklik uyarısı.
- `npm.cmd run build:desktop` ve `METIS_NATIVE_MOCK_API=1 npm.cmd run test:native`: gerçek Windows EXE, SQLite dosyası ve süreç yeniden açılışı.

Sonraki dilimde projeleri görevlerle ilişkilendirme ve notların daha zengin düzenleme deneyimi ele alınabilir. Bulut eşitlemesi ayrı bir çalışma gerektirir.
