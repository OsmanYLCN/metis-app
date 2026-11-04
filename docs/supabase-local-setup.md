# Supabase bağlantısına yerel hazırlık

M0.4'te hesap açman veya anahtar göndermen gerekmez. Varsayılan `Disabled` ile uygulama çalışır. Bu rehber, mevcut bir Supabase projesini sonraki giriş dilimine hazırlamak içindir; bu çalışmada harici proje oluşturulmadı veya bağlanmadı.

1. Kendi Supabase panelinde projenin **Project URL** değerini bul. `https://<project-ref>.supabase.co` biçimindeki adres herkese açık proje adresidir.
2. Auth signing keys ayarında asimetrik **ES256 veya RS256** kullanıldığını kontrol et. Mevcut projedeki anahtarları bu rehber için döndürme veya iptal etme. Yalnızca legacy HS256 kullanan proje bu sürümle desteklenmez. [Resmî anahtar rehberi](https://supabase.com/docs/guides/auth/signing-keys).
3. API'yi çalıştıracağın PowerShell terminalinde gerçek proje adresinle şu ayarları yap:

```powershell
$env:Identity__Provider = 'Supabase'
$env:Identity__Authority = 'https://<project-ref>.supabase.co/auth/v1'
npm.cmd run dev:api
```

Bu iki değer yalnızca o terminalin sürecine aittir. Repo dosyalarını düzenlemen gerekmez. Publishable key bile bu sunucu doğrulaması için gerekli değildir. JWT secret, service_role key, parola ve access/refresh tokenı sohbete, koda veya `VITE_*` değişkenlerine koyma.

API durumunu `http://127.0.0.1:5080/api/v1/auth/status` adresinde kontrol edebilirsin. `verificationConfigured`, ayarın kabul edildiği anlamına gelir; canlı bağlantı testi değildir. Giriş UI'ı henüz olmadığı için masaüstü uygulaması oturum açmaz. Bearer tokenı olmadan `/api/v1/auth/session` yanıtının 401 olması beklenir. Elle token paylaşman veya kopyalaman istenmiyor; gerçek hesapla uçtan uca kontrol sonraki giriş akışıyla yapılacak.

Tekrar bağlantısız çalışmak için API'yi Ctrl+C ile durdur ve aynı terminalde:

```powershell
$env:Identity__Provider = 'Disabled'
Remove-Item Env:Identity__Authority -ErrorAction SilentlyContinue
npm.cmd run dev:api
```

Supabase projen yoksa hesap/proje oluşturmayı sonraki onaylı dilimde birlikte yapabiliriz. Bu aşamada ücretli plan, hosting veya deploy gerekmiyor.
