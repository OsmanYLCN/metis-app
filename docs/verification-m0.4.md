# M0.4 — Sunucu tarafında kimlik doğrulama

Tarih: **4 Kasım 2026**, Europe/Istanbul · Sürüm: **0.4.0**

## Tamamlanan kapsam

- Standart Microsoft JWT Bearer doğrulaması, Supabase public JWKS bağlantısı ve önbelleği.
- İmza, issuer, audience, süre, hesap kimliği/rolü ve anonimlik kontrolü.
- Doğrulanmış token için gerçek 200/signedIn oturum yanıtı; diğer durumlarda 401.
- Arayüzde yapılandırılmış sağlayıcının giriş veya canlı bağlantı sanılmasını önleyen durum.
- API/test NuGet kilit dosyaları, ADR-0004 ve kısa yerel yapılandırma rehberi.

Varsayılan ayar `Disabled` olarak kaldı. Gerçek Supabase projesi bağlanmadı; hesap, token veya kullanıcı verisi oluşturulmadı. Test anahtarları yalnızca süreç belleğinde üretildi, dosyaya yazılmadı. Yeni servis hesabı, ücretli kaynak veya deploy yok.

## Çalıştırılan kontroller

| Kontrol | Sonuç |
| --- | --- |
| Sunucu kimlik testleri | **31/31 geçti**; gerçek ASP.NET TestServer hattı + gerçek JWT imza doğrulaması, yalnızca JWKS taşıması mock |
| Arayüz Vitest | **20/20 geçti** |
| TypeScript + Vite production build | Başarılı |
| NuGet locked restore | Başarılı |
| .NET çözüm Release build | Başarılı; **0 uyarı, 0 hata** |
| Tauri Windows x64 Release | **v0.4.0 EXE üretildi**, mevcut Rust bağımlılıklarıyla çevrimdışı build |

Sunucu kontrolleri: doğru RSA/EC imzası, anahtar önbelleği, yanlış issuer/audience/imza, eksik/yanlış subject, süre aşımı, gelecek başlangıç zamanı, eksik expiry, imzasız/HS256 token, servis rolü, anonim kullanıcı, eksik anonimlik bilgisi, tanınmayan anahtar, JWKS kesintisi/bozuk belge/boş liste ve geçersiz başlangıç ayarı. Her isteğin yeniden token gerektirdiği, cookie oluşmadığı, cevapların önbelleğe alınmadığı ve doğrulanmamış principal/header'ın erişim sağlamadığı kontrol edildi.

İlk test derlemesindeki EC public key tür uyuşmazlığı düzeltildi; sonraki çalıştırma geçti. Sandbox altında .NET çıktı klasörü ve Vite geçici dosya erişimi engellendi; izinli tekrarlar başarılı oldu. Bunlar önceki dilimin reddedilmiş GUI/loopback kontrollerinden ayrıdır.

## Açık kalanlar

Kullanıcının bu dilimde yeniden uğraşılmamasını istediği önceki gerçek loopback HTTP, Playwright ve native pencere kontrolleri tekrar çalıştırılmadı; başarılı sayılmadı. SQLite kodu değişmedi, Rust depolama testleri bu dilimde tekrar edilmedi. Önceki 12/12 sonucu M0.2/M0.3 kayıtlarındadır.

Canlı Supabase hesabıyla doğrulama, giriş ekranı, güvenli token saklama/yenileme, anlık iptal, yetkili iş verisi erişimi, görevler ve sync henüz yoktur. Anahtar önbelleği ve JWT iptal sınırları ADR-0004'te açıklanır.

**Durma noktası:** M0.4 sunucu doğrulama dilimi. Sonraki kullanıcı onayında gerçek proje ayarları ve masaüstü giriş akışının ilk küçük dilimi ele alınacak.
