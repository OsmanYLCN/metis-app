# Altı modülde elle buluta gönderim

Veri ve eşitleme → **Yerel kayıtları buluta gönder**. Not/proje/hedef/etkinlik/finans/bütçe kayıtları 50 kayıtlık sayfalarda listelenir. Bir kaydın **Buluta gönder** düğmesi create veya bilinen merkezi revision ile update yapar. Görevler mevcut görev gönderim alanını kullanır. Yeni SQL gerekmez; 0007–0009 kurulu olmalı. Native komutlar için geliştirme uygulamasını yeniden başlat.

Gönderimden önce mevcut içerik digest’i kontrol edilir. İstek, işlem kimliği ve beklenen revision diskte dondurulur. Bağlantı kopunca aynı düğme aynı isteği gönderir. Arada yerel kayıt değişse bile eski istek değiştirilmez; başarılı makbuz yalnızca merkezi bağlantıyı günceller, yerel yeni düzenlemeyi ezmez. Sonraki gönderimde yeni içerik alınır. Yerel kayıt silinmiş olsa bile yarım kalan istek ilk listede yeniden denenebilir; bu, silmeyi buluta taşımaz ve önceden hazırlanmış içeriği gönderebilir.

İlk gönderimde bilinmeyen bulut kaydı körlemesine güncellenmez. Aynı kimlik/natural key zaten varsa sunucu 409 döndürür. Çatışmalı isteğin güvenli iptali/yeniden hazırlanması henüz yok; işlem kaydı korunur. Bu halde tekrar tekrar basmak çözüm değildir. Yarım kalmış gönderimi olan kayda bulut kopyası uygulanmaz. Yedekten dönüş recovery_guard kilidi hem hazırlığı hem makbuz işlemeyi engeller.

Bütçelerde ilk kimlik hesap+ay+kategoriden deterministik üretilir; bilinen merkezi bağlantı varsa onun ID’si kullanılır. Kimlik ilişkileri bilinmeyen eski kayıtların toplu uzlaştırılması henüz yok. Gönderim listesi tüm yerel kayıtları gösterir; yalnızca değişmiş kayıt filtresi değildir. Değişmemiş kaydı yeniden göndermek yeni revision yaratabilir, yeni satır yaratmaz.

## Kalıcılık

`cloud-inbox.sqlite3` şema 2’ye otomatik geçer; artık outbound tablosunda gönderim niyetleri de taşır. **Bu dosya artık silinebilir bir önbellek sayılmamalı**: sonucu belirsiz işlemlerin aynı kimlikle tekrarı için gereklidir. Ana SQLite şeması 14 değişmez. Bulut bağlantısı ana SQLite’a commit edilir, sonra outbound kaydı kaldırılır. Arada kesinti olursa aynı isteğin makbuzu tekrar işlenebilir. Yerel iş kayıtları bu makbuz işleminde değiştirilmez.

Mevcut DPAPI yedek kapsamı outbound dosyasını içermez. Profil/disk kaybına dayanıklı bütünleşik gönderim günlüğü yedeklemesi ve kurtarma hâlâ açık iştir; dosyayı elle silmeyin. Canlı veriyle test yapılmadı.

## Base sürüm için kalan sınırlar

Altı modülde yerel silmeleri gönderme, otomatik arka plan eşitlemesi, çoklu seçim, kalıcı çatışma çözümü, görev planını gönderme, tam recovery uzlaştırması ve iki cihaz uçtan uca kabulü henüz yok. Bu bölüm manuel create/update yolunu açar; üretime hazır tam eşitleme olarak sunulmaz.

Doğrulama: TypeScript/Vite build, üç native inbox regresyon testi, frozen request/yeniden deneme/yanlış makbuz/yerel yeni düzenlemeyi koruma native testi; oturum HTTP makbuz ve hesap/çatışma testleri. Yeni dağıtım EXE’si oluşturulmadı.
