# Buluttan alma, birleştirme ve iki istemci doğrulaması

## Kullanım

Geliştirme uygulamasını yeniden başlat (`npm.cmd run desktop`). Yeni SQL çalıştırman gerekmez; mevcut 0006–0009 kurulumu kullanılır.

**Veri ve eşitleme → Otomatik gönderim ve kurtarma** bölümünde **Otomatik almayı aç** seç. Bu ayar otomatik gönderimden ayrıdır ve başlangıçta kapalıdır. Yalnızca alma açıkken buluta yazılmaz. **Bulutu al ve güvenle birleştir** tek seferlik alma/birleştirme yapar. Hem alma hem gönderim açıkken önce güncel bulut alınır, uygun kayıtlar birleştirilir, yerel değişiklikler gönderilir ve bulut tekrar okunur.

**Karar bekleyen çakışmalar** bölümü eski ortak sürüm, cihaz ve bulut değerlerini yan yana gösterir. Yerel veya bulut sürümünü seçip ayrıca onayla. Seçim tüm kaydı kapsar. Bulutta silinmiş kaydın aynı kimliğini yeniden canlandırma yoktur; içeriği korumak için yeni bir kayıt olarak kopyala. Bekleyen sonucu belirsiz işlem veya değişmiş önizleme varsa seçim uygulanmaz.

Açık ekranda bulut güncellemesi olduğunda yenileme bildirimi gösterilir. Düzenleme formu kendiliğinden kapanmaz; kaydettikten sonra görünümü yenile.

## Birleştirme kararı

Son doğrulanmış merkezi snapshot ortak sürümdür. Yerel ve bulut bu sürümle ayrı ayrı karşılaştırılır.

- Yalnızca bulutta değişmiş kayıt cihazda güncellenir; yalnızca yerel değişiklik korunur.
- Aynı değişiklik iki tarafta da varsa tekrar yazılmaz.
- Not başlığı/içeriği/sabitlik; proje başlığı/açıklaması/durumu; hedef açıklaması ve tarihi gibi bağımsız alanlar ayrı birleştirilir.
- Görev proje/tarih/önceliği, etkinlik gün/saat aralığı ve hedef durum/ilerlemesi ilişkili gruplardır. Aynı grupta farklı değişiklik otomatik birleştirilmez.
- Finans ve bütçede iki taraf da farklı değişmişse tüm kayıt karar bekler; ayrı finans alanlarından yeni bir işlem sentezlenmez.
- Silme–düzenleme ve ortak sürümü bilinmeyen çakışan kayıt kimliği karar bekler.
- Proje/bütçe ilişkisi veya alan doğrulaması başarısızsa o kayıt bekler; diğer kayıtlar işlemeye devam eder.

Karar bekleyen kaydın yeni gönderimi native tarafta engellenir. Tamamlanmamış ağ işlemi değiştirilmez veya iptal edilmez. Doğrulanmış sunucu reddi varsa yeni bulut sürümüyle uzlaştırılabilir. Başlamamış görev kuyruğu, birleşen içerik ve merkezi revision ile yeni işlem kimliğinde yeniden kurulur; başlamış görev isteği önce aynı kimlikle sonuçlandırılır. Görev title/completed/planning aynı revision zincirinde kalır.

## Kalıcılık ve güvenlik

Ana iş kaydı, merkezi sürüm bağı ve yeniden kurulan görev kuyruğu aynı ana SQLite transaction’ındadır. Her kayıt için savepoint vardır; bağlı kayıt engeli kısmi değişiklik bırakmaz. Gönderim niyetleri ve çakışma engelleri hesap bazında ayrı günlüğün transaction’ında tutulur; bu dosyanın silinmesi desteklenmez.

Birleştirme öncesi şifreli güvenlik yedeği alınır. Aynı yerel durumdaki tekrar eden bağımlılık hatası her tur yeni yedek üretmez. Çakışma çözümünde içerik ve kuyruk digest’i tekrar doğrulanır. Recovery guard varken normal birleştirme yapılamaz; ayrı geri yükleme uzlaştırması kullanılmalıdır.

`cloud-inbox.sqlite3` şema 5: alma ayarı, çakışma kayıtları ve son otomatik güvenlik yedeği özeti. Ana şema 14 ve yedek formatı 1 değişmez. Sıradan manuel “Bulut sürümünü uygula” yolu da başarılı uygulamadan sonra eski çakışma engelini kaldırır.

## İki istemci testi

`npm.cmd run test:two-clients` iki ayrı native süreç ve iki ayrı SQLite/gönderim günlüğü klasörü çalıştırır. Native komut köprüsü yalnızca Rust test derlemesindedir; ürün uygulamasına girmez. SQL gerçek 0001–0009 migration fonksiyonlarıyla izole PGlite üzerinde çalışır; reader/writer rolleri ve hesap claim’leri uygulanır.

Geçen yedi senaryo:

1. İlk kayıt çoğaltma.
2. Birbirinden bağımsız çevrimdışı düzenlemelerin iki tarafta aynı sonuca ulaşması.
3. Aynı alanın çakışması, eskimiş kararın reddi ve açık kullanıcı seçimi.
4. Süreci yeniden başlatınca aynı işlem kimliğiyle kayıp makbuzun tekrar alınması.
5. Sonucu belirsiz isteğin korunması, kesin ret sonrasında birleştirme.
6. Silme–düzenleme çakışmasında yerel değişikliğin korunması.
7. Kalıcı cursor ve başka hesabın kayıtlarını okuyamama.

Sonuç `test-results/dual-client-run-*/report.json` dosyasındadır. Bu, aynı bilgisayarda iki bağımsız native istemci + gerçek SQL testidir. HTTP/Supabase ve iki fiziksel cihaz testi değildir; PGlite çok oturumlu PostgreSQL yarış davranışını kanıtlamaz. İki fiziksel cihaz ve canlı Supabase kabulü ayrıca yapılmalıdır. Kullanıcının gerçek verileri, profili veya anahtarları kullanılmadı.

Ek doğrulama: native depolama/geri yükleme kontrolleri; ilişkili finans/saat alanlarının birleştirilmemesi; görev planı korunarak başlık kuyruğunu yeniden kurma; sonucu belirsiz görev isteğine dokunmama; HTTP oturum/ret ve koordinatör kontrolleri; TypeScript/Vite build. Dağıtım EXE’si oluşturulmadı.
