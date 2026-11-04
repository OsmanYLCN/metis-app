# M0.5 — Metis adı ve masaüstü giriş akışı

Tarih: **4 Kasım 2026**, Europe/Istanbul · Sürüm: **0.5.0**

## Tamamlananlar

- Görünür marka, pencere/sayfa başlıkları Metis olarak güncellendi. Var olan yerel veri alanının kimliği korundu.
- Public proje ayarı doğrulaması; API ile issuer eşleşmesi; mevcut Auth kullanıcısı için e-posta/parola formu.
- Doğrudan Supabase HTTPS giriş isteği ve ardından gerçek API oturum doğrulaması.
- Sadece bellek oturumu; navigasyonda devam, iptal, çift gönderim koruması, süre sonu/uykudan dönüş kontrolü, yerel kapsamlı çıkış.
- Seçilen tek Supabase host'una CSP izni veren masaüstü betiği ve aynı public dosyadan API issuer'ı türeten geliştirme betiği.
- Boş `.env.example`, güncellenen bağlantı rehberi, ADR-0005, yeni davranış ve UI testleri.

## Sonuçlar

| Kontrol | Sonuç |
| --- | --- |
| Vitest | **38/38 geçti**; giriş/çıkış, süre sonu, iptal, proje uyuşmazlığı, hata ve kalıcılık sınırları dahil |
| ASP.NET TestServer / JWT | **31/31 geçti**; public issuer sözleşmesi eklendi, gerçek imza doğrulaması korundu |
| Yeni giriş UI testleri (Edge) | **2/2 geçti**; tüm API/Supabase yanıtları mock, gerçek hesap kullanılmadı |
| TypeScript + Vite | Production build başarılı |
| Tauri Windows x64 | **Metis 0.5.0 EXE başarıyla üretildi**; mevcut Rust bağımlılıklarıyla offline derleme |
| Yeni geliştirme betikleri | `node --check` başarılı |
| Git diff kontrolü | Whitespace hatası yok; kaynaklar commit edilmedi/pushlanmadı |

Arayüz kontrolü form gönderimini, API reddini, parola alanının temizlenmesini, navigasyonda oturumun korunmasını, logout/reload sonrasında kapanmasını, browser storage'ın boş kalmasını ve dar ekranda taşma olmamasını kapsar. Test ekran görüntüsü görsel olarak incelendi: `test-results/m0.5-login.png` (Git dışında).

## Sınırlar

Kullanıcı mevcut Supabase projesi/kullanıcısı olduğunu bildirdi ancak **yerel değerleri henüz girmeden kod diliminin tamamlanmasını istedi**. `.env.local` oluşturulmadı; gerçek hesabına giriş, canlı JWKS veya gerçek Supabase CORS kontrolü yapılmadı. Çalışır giriş kodu ile gerçek hesapta doğrulanmış bağlantı aynı şey değildir.

Önceki loopback/native smoke testleri tekrar edilmedi. Yeni iki UI testi browser'da mock yanıtlarla çalıştı; Windows WebView2 içinde canlı giriş testi değildir. SQLite kodu değişmedi; eski Rust testleri bu dilimde tekrar edilmedi.

Kalıcı token saklama/refresh, signup/reset/OAuth/MFA/CAPTCHA akışları, iş verileri ve sync yoktur. Kapanış yerel oturumu siler ama sunucuda revoke garantisi vermez; çıkış da JWT'yi anında iptal etmez. Yeni ücretli servis veya deploy yoktur.

## Kullanıcıya kalan kısa adım

`apps/desktop/.env.example` → `.env.local`; yalnızca public URL ve publishable key doldur. İki terminalde `npm.cmd run dev:api` ve `npm.cmd run desktop`. Parola yalnızca uygulamadaki giriş alanına yazılır. Ayrıntılar: [Supabase bağlantı rehberi](supabase-local-setup.md).

Bu dilim burada durur. Sonraki onayda gerçek hesapla bağlantı kontrolü ve güvenli cihaz oturumunun ilk adımı ele alınabilir.

Önerilen commit: `feat: rename app to Metis and add desktop sign-in`
