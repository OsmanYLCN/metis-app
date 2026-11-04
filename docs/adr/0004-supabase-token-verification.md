# ADR-0004 — Supabase sunucu token doğrulaması

Tarih: 2026-11-04 · Durum: M0.4'te uygulandı

## Karar ve sınır

API, `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.12 ve onun IdentityModel bağımlılıklarıyla doğrular. İmza doğrulama algoritması uygulama içinde yazılmaz. NuGet kilit dosyaları API ve test projesinde tutulur; `dotnet restore PersonalOS.slnx --locked-mode` tekrarlanabilir kurulumu kontrol eder.

Varsayılan sağlayıcı hâlâ `Disabled`. `Supabase` seçilirse yalnızca izin verilen public issuer üzerinden `/.well-known/jwks.json` okunur. Token içindeki URL'ler kaynak seçemez. HTTP yönlendirmeleri kapalı, istek süresi 5 saniye, belge sınırı 256 KiB'dir. Özel domain, self-hosting ve legacy HS256 bu dilimin dışında kalır; gizli JWT/service-role anahtarı istenmez.

Tokenın imzası, issuer, `authenticated` audience, bitiş zamanı ve varsa başlangıç zamanı doğrulanır. Saat toleransı 30 saniyedir. Yalnızca ES256/RS256; tek, boş olmayan UUID `sub`; `role=authenticated` ve `is_anonymous=false` kabul edilir. Eksik anonimlik bilgisi de reddedilir. `user_metadata` kimlik/yetki kaynağı değildir. Kullanıcı yanıtında yalnızca doğrulanmış `sub` döner, `displayName` null kalır.

`GET /api/v1/auth/session`, adlandırılmış Bearer şemasından doğrulama sonucu ister; dışarıdan atanmış `HttpContext.User` yeterli değildir. Başarı 200/signedIn, eksik veya reddedilen token 401/signedOut/null-user ve genel `WWW-Authenticate: Bearer` döndürür. Her yanıt no-store; cookie, token saklama veya sunucu oturumu yoktur. Her istek kendi Bearer tokenını taşımalıdır.

`GET /api/v1/auth/status` yapılandırma bilgisidir. Supabase ayarı varsa `verificationConfigured`, yoksa `notConfigured` döner. `signInAvailable=false` ve `sessionPersistence=none` korunur. Yapılandırılmış olmak gerçek servise erişildiğini veya giriş yapılabildiğini göstermez. Arayüz bu ayrımı gösterir; önceki `connectionPending` sözleşmesini de okuyabilir.

## Anahtar yenileme ve pratik sınırlar

Microsoft ConfigurationManager anahtarları bellekte tutar: otomatik yenileme aralığı 5 dakika, yenileme isteği aralığı 1 dakika; tanınmayan anahtar yenilemeyi tetikler. Last-known-good geri dönüşü kapalıdır. İlk yüklemede anahtar alınamazsa kullanıcı doğrulanmaz. Önceden alınmış mevcut yapılandırma, arka planda yenileme veya geçici servis kesintisi sırasında kullanılabilir; 5 dakika kesin bir anahtar son kullanma sınırı değildir. Supabase'in kendi anahtar önbelleği de vardır. Bu nedenle anlık hesap/oturum veya anahtar iptali garantisi verilmez; logout mevcut JWT'yi süresi dolmadan kendiliğinden hükümsüz yapmaz. Acil anahtar iptalinde API sürecini yeniden başlatmak yerel önbelleği temizler, sağlayıcı önbelleğini temizlemez.

Bu dilimde uzaktan deployment, gerçek hesap bağlantısı, RLS/veri sahipliği, giriş/yenileme/çıkış UI'ı, token saklama, görev CRUD veya sync yapılmaz. Gelecekte iş endpoint'leri için ayrı yetkilendirme gerekir; doğrulanmış kullanıcı olmak bütün verilere erişim değildir. Mevcut loopback geliştirme ayarları uzaktan yayın için onay sayılmaz.

## Kaynaklar

- [Microsoft: JWT Bearer yapılandırması](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication?view=aspnetcore-10.0): standart doğrulama bileşeni ve issuer/audience/lifetime kontrolleri.
- [Supabase: signing keys](https://supabase.com/docs/guides/auth/signing-keys): public JWKS adresi, asimetrik anahtarlar ve sağlayıcı önbelleği.

## Doğrulama yaklaşımı

TestServer gerçek ASP.NET istek hattını port açmadan çalıştırır. Testler çalışma anında RSA/EC anahtarları üretir ve yalnızca uzak JWKS HTTP taşımasını taklit eder. Üretim doğrulayıcısında bypass veya test anahtarı bulunmaz. Gerçek Supabase hesabı bu testlerin parçası değildir. Sonuçlar: [M0.4 doğrulama kaydı](../verification-m0.4.md).
