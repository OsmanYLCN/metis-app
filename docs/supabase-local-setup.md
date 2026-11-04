# Metis — mevcut Supabase projesini bağlama

M0.5 kodu hazır; kullanıcı isteğiyle gerçek proje ayarları bu dilimde boş bırakıldı. Yeni proje/ücretli servis oluşturulmaz. Aşağıdaki ayarları kendi bilgisayarında yap; parola, token veya secret key'i sohbete gönderme.

1. Proje kökünde, `apps/desktop/.env.example` dosyasını **`apps/desktop/.env.local`** olarak kopyala. Varsa mevcut `.env.local` dosyanı üzerine yazmadan düzenle.
2. Supabase panelindeki **Project URL** ve **Publishable key** değerlerini bu dosyaya yaz:

```dotenv
VITE_SUPABASE_URL=https://PROJE-REFERANSIN.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_BURAYA_PUBLIC_DEGER
```

Gerçek adresin küçük harfli proje referansını kullan. Bunlar istemciye dağıtılabilen public değerlerdir. `sb_secret_`, `service_role`, JWT secret, kullanıcı parolası veya access/refresh token bu dosyaya konulmaz. Legacy `anon` JWT anahtarı bu ilk giriş diliminde desteklenmez. `.env.local` Git dışında kalır; yalnızca boş `.env.example` commit edilir.

3. Projede **Authentication → Users** altında giriş yapacağın kullanıcı bulunmalı, e-posta/parola girişi açık ve hesabın gerekli e-posta doğrulaması tamamlanmış olmalı. Supabase paneline girdiğin yönetici hesabı, uygulamanın Auth kullanıcısıyla aynı şey değildir. Gerekirse panelin kullanıcı oluşturma akışını kendin kullan; parola yalnızca panelde ve Metis giriş ekranında girilir. Mevcut güvenlik kontrollerini kapatma. OAuth-only, MFA/CAPTCHA gerektiren giriş ekranları bu dilimde tamamlanmadı.
4. İmza anahtarı **ES256 veya RS256** olmalı. Eski HS256 tokenı M0.4 doğrulayıcısı kabul etmez. Mevcut anahtarları bu rehber için gelişigüzel döndürme/iptal etme. [Resmî signing keys rehberi](https://supabase.com/docs/guides/auth/signing-keys).
5. Proje kökünde iki terminal aç:

```powershell
# Terminal 1 — API, aynı public proje adresini .env.local'dan okur
npm.cmd run dev:api
```

```powershell
# Terminal 2 — masaüstü; gerekirse yerel Rust yardımcısını yükle
. ./scripts/use-workspace-rust.ps1
npm.cmd run desktop
```

API terminalinde daha önceden `Identity__Provider` veya `Identity__Authority` ayarladıysan bunlar dosyadan türetilen ayara göre önceliklidir. İstenmeyen eski override'ları o terminalde kaldır veya yeni bir terminal aç. `GET http://127.0.0.1:5080/api/v1/auth/status` yanıtında `verificationConfigured` ve doğru public `issuer` görünür; bu tek başına canlı Supabase bağlantı testi değildir.

Metis'teki “Hesap & oturum” kartından e-posta/parolanla giriş yap. Başarı hem sağlayıcıdan token alınmasını hem API'nin doğrulamasını gerektirir. Parola alanı gönderimde temizlenir. “Bu cihazdan çıkış yap” yalnızca mevcut oturumu hedefler. Uygulama kapanınca veya token süresi dolunca tekrar giriş gerekir.

## EXE ve ayar değişiklikleri

`.env.local` değişince çalışan Vite/Tauri sürecini yeniden başlat. Derlenmiş EXE bu dosyayı sonradan okumaz. Kendi proje ayarlarınla yeni EXE üretmek için:

```powershell
. ./scripts/use-workspace-rust.ps1
npm.cmd run build:desktop
```

Çıktı: `apps/desktop/src-tauri/target/release/personal-os-desktop.exe`; görünür ürün adı Metis'tir. Public URL/key bu derlemeye dahil olur. `outputs/Metis-M0.5.exe` ayarlar boşken üretilen önizlemedir; canlı giriş için yeniden derleme gerekir. API ayrı terminalde çalışmaya devam etmelidir.

## Sık görülen durumlar

- **Giriş ayarları eksik/eşleşmiyor:** `.env.local`, API issuer ve çalışan build aynı projeyi göstermeli.
- **Giriş yapılamadı:** Auth kullanıcısı, e-posta doğrulaması ve parola yöntemini kontrol et; ham hata/anahtar paylaşma.
- **Metis oturumu doğrulayamadı:** API açık mı, signing key asimetrik mi, issuer doğru mu kontrol et.
- **Çok fazla deneme:** Sağlayıcının bekleme süresi dolmadan tekrar deneme.

Bu dilimde kayıt/sıfırlama, kalıcı oturum, refresh, görev verisi, merkezi PostgreSQL bağlantısı veya sync yoktur.
