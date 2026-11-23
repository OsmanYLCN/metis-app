# Altı modülde elle buluta gönderim

Veri ve eşitleme → **Yerel kayıtları buluta gönder**. Not/proje/hedef/etkinlik/finans/bütçe kayıtları 50 kayıtlık sayfalarda listelenir. Bir kaydın **Buluta gönder** düğmesi create veya bilinen merkezi revision ile update yapar. Görevler mevcut görev gönderim alanını kullanır. Yeni SQL gerekmez; 0007–0009 kurulu olmalı. Native komutlar için geliştirme uygulamasını yeniden başlat.

Gönderimden önce mevcut içerik digest’i kontrol edilir. İstek, işlem kimliği ve beklenen revision diskte dondurulur. Bağlantı kopunca aynı düğme aynı isteği gönderir. Arada yerel kayıt değişse bile eski istek değiştirilmez; başarılı makbuz yalnızca merkezi bağlantıyı günceller, yerel yeni düzenlemeyi ezmez. Sonraki gönderimde yeni içerik alınır. Yerel kayıt silinmiş olsa bile yarım kalan istek ilk listede yeniden denenebilir; bu tekrar, ilk hazırlanan işlemi tamamlar. Önceden hazırlanmış create/update isteği eski içeriği gönderebilir; daha sonra silmeyi ayrıca onaylamalısın.

İlk gönderimde bilinmeyen bulut kaydı körlemesine güncellenmez. Aynı kimlik/natural key zaten varsa sunucu 409 döndürür. Oturum değişmeden alınan 409 + workspace_conflict yanıtı, isteğin uygulanmadığını doğrular ve diskte reddedildi olarak işaretlenir. **Reddedilen isteği kaldır** yalnızca bu durum için açılır; yerel kayıt veya merkezi sürüm bağı değişmez. Ardından bulut değişikliklerini indir, karşılaştır ve açık onayla bulut kopyasını uygula (yerel uygulama öncesi mevcut güvenlik yedeği alınır). İstediğin değişikliği bu sürüm üzerinde tekrar düzenleyip gönder. Bu akış otomatik birleştirme yapmaz. Genel 409, workspace_operation_conflict, 404, okunamayan yanıt, ağ kesintisi veya oturum değişimi iptal izni vermez; aynı istek korunur. Yarım kalmış gönderimi olan kayda bulut kopyası uygulanmaz. Yedekten dönüş recovery_guard kilidi hem hazırlığı hem makbuz işlemeyi engeller.

Bütçelerde ilk kimlik hesap+ay+kategoriden deterministik üretilir; bilinen merkezi bağlantı varsa onun ID’si kullanılır. Kimlik ilişkileri bilinmeyen eski kayıtların toplu uzlaştırılması henüz yok. Gönderim listesi tüm yerel kayıtları gösterir; yalnızca değişmiş kayıt filtresi değildir. Değişmemiş kaydı yeniden göndermek yeni revision yaratabilir, yeni satır yaratmaz.

## Yerel silmeyi buluta taşıma

**Cihazdan sildiklerin** bölümünde, bilinen canlı bir merkezi sürümü olan ve artık cihazda bulunmayan kayıtlar görünür. **Buluttan da sil → Silmeyi onayla** ile işlem hazırlanır. Hazırlık sırasında sürüm özeti yeniden kontrol edilir ve kayıt hâlâ yerelde yok olmalıdır. Başka bir gönderim varsa önce o tamamlanır.

Silme isteği boş payload ve bilinen revision ile diske yazılır; ağ kesilirse **Aynı silmeyi tekrar dene** aynı işlem kimliğini kullanır. Başarı yalnızca merkezi bağlantıyı silinmiş olarak işaretler. İstek sürerken aynı kimlikle yeniden oluşturulan yerel kayıt silinmez. Bu kayıt korunur ancak silinmiş merkezi kimlikle tekrar gönderilemez; yeni kimlik veya ayrı uzlaştırma gerekir. Bütçeler ay/kategori ilişkisiyle denetlenir. Proje silmenin sunucudaki mevcut görevlere etkisi 0009 migration tarafından yönetilir.

## Kalıcılık

`cloud-inbox.sqlite3` şema 3’e otomatik geçer; artık outbound tablosunda gönderim niyetleri de taşır. **Bu dosya artık silinebilir bir önbellek sayılmamalı**: sonucu belirsiz işlemlerin aynı kimlikle tekrarı için gereklidir. Eski şema 2 gönderimleri işlem kimliği ve içeriği korunarak create/update olarak taşınır; yeni kayıtlarda işlem türü ve reddedilme durumu saklanır. Ana SQLite şeması 14 değişmez. Bulut bağlantısı ana SQLite’a commit edilir, sonra outbound kaydı kaldırılır. Arada kesinti olursa aynı isteğin makbuzu tekrar işlenebilir. Yerel iş kayıtları bu makbuz işleminde değiştirilmez.

Mevcut DPAPI yedek kapsamı outbound dosyasını içermez. Profil/disk kaybına dayanıklı bütünleşik gönderim günlüğü yedeklemesi ve kurtarma hâlâ açık iştir; dosyayı elle silmeyin. Canlı veriyle test yapılmadı.

## Base sürüm için kalan sınırlar

Otomatik arka plan eşitlemesi, çoklu seçim, otomatik birleştirme/yeniden temel alma, silinmiş kimliğin yeniden kullanımı, görev planını gönderme, tam recovery uzlaştırması ve iki cihaz uçtan uca kabulü henüz yok. Bu bölüm manuel create/update/delete ve doğrulanmış reddi kaldırma yolunu açar; üretime hazır tam eşitleme olarak sunulmaz.

Doğrulama: TypeScript/Vite build; 7 native inbox/outbound testi (eski şema geçişi, silme onayı için güncel kayıt kontrolü, yeniden deneme, yerel yeni kaydı koruma ve kesin ret dışındaki isteklerin iptal edilememesi dahil); 40 oturum/HTTP testi. Yeni dağıtım EXE’si oluşturulmadı.
