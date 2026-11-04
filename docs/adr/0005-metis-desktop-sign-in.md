# ADR-0005 — Metis adı ve geçici masaüstü oturumu

Tarih: 2026-11-04 · Durum: M0.5'te uygulandı

## Kapsam

Ürün adı **Metis**. Pencere, sayfa başlığı ve görünür marka değişti. Mevcut uygulama kimliği `com.personalos.desktop`, SQLite dosya adı, ortam değişkenleri, npm workspace ve C# ad alanları bu dilimde korunur; mevcut veri alanı yeniden oluşturulmaz. GitHub repo adresine, branch'e veya klasör yoluna müdahale edilmez.

M0.5 yalnızca mevcut bir Supabase Auth kullanıcısının e-posta/parola ile girişini, API doğrulamasını ve geçici cihaz oturumunu ekler. Kayıt, parola sıfırlama, OAuth/deep-link, MFA/CAPTCHA ekranları, refresh akışı ve kalıcı secret store ayrı dilimlerdir. Bu akışların gerektirdiği mevcut sağlayıcı güvenlik ayarları otomatik değiştirilmez.

## Giriş akışı

1. İstemci yalnızca geçerli hosted Supabase HTTPS adresi ve `sb_publishable_` anahtarını kabul eder. Eksik ayarda giriş formu açılmaz; secret/service-role/legacy JWT key kabul edilmez.
2. API'nin `/api/v1/auth/status` yanıtına herkese açık `issuer` eklendi. İstemci bu adresi kendi ayarıyla birebir karşılaştırır. API yoksa veya projeler farklıysa parola göndermez. Eski API sürümü issuer bildirmediğinden giriş açılmaz.
3. Parola doğrudan projenin HTTPS `/auth/v1/token?grant_type=password` endpoint'ine gönderilir. Yerel API parolayı almaz. Mevcut Supabase Auth REST sözleşmesi için dar bir fetch adaptörü kullanılır; JWT doğrulaması istemcide yazılmaz.
4. Dönen access token yerel API'nin `/api/v1/auth/session` endpoint'ine gönderilir. Yalnızca başarılı doğrulama ve geçerli kullanıcı sözleşmesinden sonra “Oturum açık” gösterilir. Başarısız/iptal girişten gelen token için mümkünse yerel kapsamlı revoke denenir.
5. Çıkış önce uygulamanın bellek oturumunu siler; ardından sağlayıcıya `scope=local` çıkış isteği yapar. Diğer cihazların oturumlarına global çıkış gönderilmez. Ağ hatasında yerel çıkış gerçekleşir, sunucudaki iptalin doğrulanamadığı gösterilir.

İstekler cookie kullanmaz, cache'e alınmaz ve credential taşıyan yönlendirmeleri takip etmez. Hata metinleri uygulamada tanımlıdır; ham sağlayıcı yanıtı/parola/token loglanmaz. Zaman aşımı: sağlayıcı giriş 15 saniye, API doğrulama 8 saniye, çıkış 5 saniye. Aynı anda ikinci giriş engellenir; iptal sonrası geç gelen yanıt oturum açamaz.

## Oturum ömrü

Uygulama ömrüne bağlı tek bellek deposu kullanılır. Dashboard'dan başka modüle geçmek oturumu silmez; reload/kapanış siler. Password input gönderim sırasında boşaltılır; parola uygulama state'ine veya diske yazılmaz. Refresh token yanıtta gelse de tutulmaz/kullanılmaz. Access token UI snapshot'ına, localStorage/sessionStorage/cookie/SQLite'a yazılmaz.

Süre dolunca ve uyku/arka plan sonrası odak-görünürlük değişiminde tekrar giriş gerekir. Otomatik yenileme yoktur. Uygulamanın kapanması sunucuda logout garantisi vermez. Logout da verilmiş JWT'yi anında hükümsüz yapmaz; M0.4'teki süre/anahtar önbelleği sınırları sürer. İş modülleri hâlâ önizlemedir; oturum açmak bu modülleri kullanılabilir yapmaz.

## Yapılandırma ve CSP

`apps/desktop/.env.local` yalnızca public proje adresi ve publishable key içerir; Git dışında kalır. Bu değerler Vite derlemesine girer ve gizli sayılmaz. Mevcut EXE sonradan bu dosyayı okumaz; ayar değişince geliştirme süreci veya derleme yenilenir. `scripts/desktop.mjs`, seçili tek HTTPS proje origin'ini Tauri CSP'ye CLI override ile ekler. Wildcard host/uzak IPC izni açılmaz; temel JSON ayar dosyası bağlantısız kalır.

`scripts/dev-api.mjs`, açık bir `Identity__Provider`/`Identity__Authority` override'ı yoksa geliştirme ortamında aynı dosyadan issuer üretir. Production API ayarları standart ASP.NET yapılandırmasıyla yönetilir. Backend'in `signInAvailable=false` alanı API'nin kendisinin giriş başlatma endpoint'i sunmadığını belirtir; istemci formu eşleşen public proje ayarlarıyla açılır. `sessionPersistence=none` sunucunun cookie/session saklamadığını belirtmeye devam eder.

## Kaynaklar ve doğrulama

- [Supabase Auth REST API](https://github.com/supabase/auth#post-token): parola grant'i ve token sözleşmesi.
- [Supabase public/secret key ayrımı](https://supabase.com/docs/guides/getting-started/api-keys).
- [Supabase local sign-out ve JWT iptal sınırı](https://supabase.com/docs/reference/javascript/auth-signout).

Otomatik testlerde sahte sağlayıcı yanıtları ve geçici test kimlikleri kullanılır; gerçek hesaba giriş yapılmaz. [M0.5 doğrulama kaydı](../verification-m0.5.md).
