# Taşınabilir yedek ve cihaz kurtarma

Paket 1, 25 Kasım 2026. **Veri ve eşitleme → Taşınabilir şifreli yedek** masaüstünde giriş yapılmadan da kullanılabilir. Önceden oluşturulmuş bir yedek gerekir; kaybolmuş ve hiç yedeklenmemiş yerel veri kurtarılamaz.

## Yedek almak

1. En az 12 karakterlik ayrı bir yedek parolası yaz ve ikinci alanda tekrarla. Bu parolayı sohbete veya projedeki dosyalara yazma.
2. **Dosyaya yedekle** düğmesine bas, yeni bir dosya adı seç. Var olan dosya üzerine yazılmaz.
3. `.metisportable` dosyasını başka bir diske veya kendi güvenli yedek alanına kopyala. Parolayı ayrı bir yerde sakla.

Bu yedek **cihazdaki tüm Metis hesaplarını** kapsar: görev/plan, not/proje, hedef, takvim, finans/bütçe, bildirim tercihleri, bulut sürüm bağlantıları, görev gönderim makbuzları, ayrı outbound günlüğü, inbox/cursor, çakışma ve kurtarma bilgisi. Servis parolaları, giriş tokenları, `.env.local`, .NET User Secrets, eski yedek arşivleri ve kaydedilmemiş form metinleri dahil değildir. Canlı SQLite dosyalarının kendisi şifrelenmiş olmaz.

## Yeni Windows profili, yeni cihaz veya bozuk SQLite

1. Metis’i aç → **Veri ve eşitleme**. Yerel alan hatalı olsa da bu sayfadaki taşınabilir kurtarma kullanılabilir.
2. Yedeğin parolasını ilk alana yaz → **Mevcut yedeği seç ve incele**. İkinci parola alanı yalnızca yeni yedek oluştururken gereklidir.
3. Kayıt/hesap sayısını incele. Tüm yerel veri alanının değişeceğini onaylamak için ekrandaki cümleyi yaz → **Geri yükle ve yeniden başlat**.
4. Yeni cihazsa normal Supabase public bağlantı ayarlarını ve API bağlantısını kur; aynı Metis hesabına giriş yap. Anahtar/parola paylaşma. Yedek giriş oturumunu taşımaz.
5. Önce **Bulutu al ve güvenle birleştir**, ardından bekleyen gönderimleri çalıştır. Sonucu belirsiz istekler aynı işlem kimliğiyle yeniden denenir. Çakışmalarda karşılaştırıp karar ver. İstiyorsan otomatik alma/göndermeyi sonra aç.

Kaynak cihazdan taşınıyorsan kaynakta eşitlemeyi kapatıp yeni cihazdan devam et. Eski yedeğin bulutta artık silinmiş kaydını aynı kimlikle diriltmek desteklenmez; içerik gerekiyorsa yeni kayıt oluştur. Finans ve aynı alan çakışmaları otomatik ezilmez. Eski yedek zaten kurtarma kilidi içeriyorsa kilit korunur; mevcut uzlaştırma ekranı kullanılmalıdır.

## Dosya güvenliği ve kesinti davranışı

- PBKDF2-HMAC-SHA256, 600.000 tur, rastgele 16 bayt salt; AES-256-GCM, rastgele 12 bayt nonce, doğrulanan format başlığı. Yanlış parola veya değişmiş şifreli içerik reddedilir. Parola ve anahtar tamponları iş bitiminde temizlenir; parola kurtarma servisi yoktur.
- Format `METISPB1`; sabit KDF maliyeti, en fazla 64 MiB dosya, tablo başına 200.000 satır ve en fazla 1.000 hesap. Ana veri şeması 14, inbox/outbound şeması 5. Arşivden SQL veya dosya yolu çalıştırılmaz; yalnızca sabit tablo/kolon listeleri kullanılır.
- İki SQLite dosyasının kayıtları cache → main kilit sırasıyla tutarlı biçimde alınır. İstek kimliği ve dondurulmuş payload dahil olmak üzere iki gönderim günlüğü korunur.
- İçe aktarma uygulama veri kökünde `restored/<rastgele kimlik>/` altında yeni ve doğrulanmış iki veritabanı oluşturur. İnceleme aktif veriyi değiştirmez. Başarısız/iptal edilmiş hazırlık aktif hale gelmez; hazırlanmış kopyalar yerel veri klasöründe kalabilir.
- Onay, `pending-restore` işaretini atomik yazar. Yeniden açılışta cihazın tek süreç kilidi alınır, iki dosyanın bütünlüğü ve önizleme özeti tekrar kontrol edilir, işaret atomik olarak `active-storage` olur. Bu noktadan önceki kesinti eski alanı bırakır; sonraki kesinti yeni alanla devam eder.
- Önceki `storage/` veya `restored/<önceki kimlik>/` klasörü silinmez. Hesap oturumları ayrı `sessions/` alanında kalır. Mevcut kullanıcı profiline bağlı `.metisbackup` yedekleri desteklenmeye devam eder; onların kapsamı ve kurtarma kilidi farklıdır.
- Geri yüklemede otomatik alma/gönderme kapatılır ve eski “bulut güncel” zamanı temizlenir. Sunucu sürüm kontrolleri ile kalıcı makbuzlar eski yedeğin yeni bulut verisini sessizce ezmesini önler. Yedek tarihinden sonraki, hiç buluta gönderilmemiş değişiklikler yedekte bulunmaz.

## Doğrulama

70 native depolama kontrolü geçti; yeni taşınabilir kontroller yanlış parola, başlık/içerik değişikliği, eksik dosya, eski önizleme, bozuk eski SQLite’yı koruma, onaydan önce aktivasyon olmaması, tekrar başlangıç ve iki günlükte belirsiz işlem kimliğinin korunmasını kapsıyor. Son değişiklikten sonra 4 hedefli kontrol ayrıca geçti; çok hesaplı dönüş ve yeniden başlatma kilidinin devri de kapsandı. Windows profiline bağımlı bir şifreleme anahtarı kullanılmıyor; ikinci fiziksel Windows profili/cihaz üzerinde kullanıcı kabulü bu oturumda yapılmadı.

Uygulanan şifreleme bileşenleri: [RustCrypto AES-GCM](https://docs.rs/aes-gcm/0.10.3/aes_gcm/), [RustCrypto PBKDF2](https://docs.rs/pbkdf2/0.12.2/pbkdf2/). Kriptografik tasarım bağımsız bir ürün güvenlik denetiminin yerine geçmez.
