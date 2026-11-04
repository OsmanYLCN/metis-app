# ADR-0003 — Bağlantısız hesap ve oturum temeli

Tarih: 2026-11-04 · Durum: M0.3'te uygulandı

## Kapsam ve karar

Bu dilim, kimlik sağlayıcısına bağlanmadan modül sınırını, yapılandırma doğrulamasını, açık oturum sözleşmesini ve arayüz durumlarını oluşturur. Gerçek hesap açma/giriş, JWT doğrulama, token yenileme/saklama, deep link, kullanıcı tabloları, yetkili iş endpoint'leri ve sync bu dilimde yoktur.

`services/api/Modules/Identity` kendi options, validator, sağlayıcı sınırı, DTO ve endpoint'lerini taşır. Varsayılan sağlayıcı `Disabled`. `Supabase` seçildiğinde yalnızca doğrulanmış biçimde issuer yapılandırması kabul edilir ve `connectionPending` döner. Bu ayar gerçek bağlantı veya doğrulanmış kullanıcı anlamına gelmez.

## Sözleşme

| Endpoint | Sonuç |
| --- | --- |
| `GET /api/v1/auth/status` | 200; `status`, `provider`, `signInAvailable: false`, `sessionPersistence: "none"` |
| `GET /api/v1/auth/session` | 401; `authenticated: false`, `state: "signedOut"`, `user: null` |

Her iki cevap `Cache-Control: no-store` kullanır, cookie oluşturmaz. Sunucu URL'si, girilen yapılandırma değerleri ve token içerikleri yanıtlanmaz. Arayüz yalnızca tanıdığı bağlantısız durumları kabul eder; beklenmeyen `signInAvailable: true` yanıtını başarıya dönüştürmez.

## Güvenlik sınırı

**Bu modül henüz kimlik doğrulama sistemi değildir.** Sağlayıcı adaptörleri token okumaz/çözmez ve ağ isteği yapmaz. `Authorization`, `X-User-Id` veya doğrulanmamış kimlik bilgisi bu dilimde oturum oluşturamaz. Oturum endpoint'i her zaman 401 döndürür. İleride gerçek kullanıcı döndürülmeden önce sunucuda imza, issuer, audience ve geçerlilik doğrulanmalı; mevcut bağlantısız adaptörün davranışı açıkça değiştirilmelidir.

Yapılandırma [ASP.NET Core options doğrulaması](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options?view=aspnetcore-10.0) ile başlangıçta kontrol edilir. Bilinmeyen sağlayıcı, çelişkili ayar, HTTP, IP/yerel host, kullanıcı bilgisi içeren URL, query/fragment, özel port ve farklı endpoint reddedilir. Bu ilk sürüm yalnızca `https://<project-ref>.supabase.co/auth/v1` biçimini kabul eder; özel domain ve self-hosting daha sonra ayrı doğrulama kararı gerektirir. Başlangıç hata mesajları verilen değeri tekrar etmez.

Gelecek entegrasyon, [Supabase signing keys/JWKS sözleşmesini](https://supabase.com/docs/guides/auth/signing-keys) izleyecek; imza doğrulamayı kapatan bir demo yolu eklenmeyecek. M0.3'te JWKS isteği veya gerçek token doğrulaması yapılmadı.

Token, parola veya servis anahtarı frontend `VITE_*` değişkenlerine, tarayıcı depolarına ya da mevcut şifrelenmemiş SQLite'a yazılmaz. Henüz bir secret saklama adaptörü uygulanmadı. Sağlayıcı için API anahtarı alanı eklenmedi; bu aşamada kullanıcıdan gizli bilgi gerekmez.

## Doğrulama

Paket indirmeden çalışan .NET kontrol projesi gerçek mapped endpoint delegate'lerini süreç içinde çalıştırır. Bu, ağ üzerinden HTTP veya WebView2 testi değildir. Options doğrulaması, bağlantısız sağlayıcı durumları, no-store/cookie sınırı, eksik ve sahte kimliğin 401 olarak kalması test edilir. React istemcisi sözleşme/hata/iptal testleriyle ayrıca kontrol edilir.

## Sonraki sınır

Önerilen M0.4: izinli ortamda açık kalan uçtan uca kontrolleri kapatmak ve Supabase Auth için gerçek bağlantı + sunucu token doğrulamasının ilk küçük dilimini hazırlamak. Harici hesap işlemi gerektiğinde kullanıcıya kısa talimat verilecek; gizli anahtar sohbete istenmeyecek. Görev iş akışı ve sync ayrı onaylı dilimler olarak kalır.
