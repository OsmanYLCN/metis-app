# Otomatik gönderim, görev planı ve geri yükleme uzlaştırması

## Kullanım

1. Geliştirme uygulamasını kapatıp proje klasöründe `npm.cmd run desktop` ile yeniden aç. Yerel API açık olmalı.
2. **Veri ve eşitleme → Otomatik gönderim ve kurtarma** bölümüne gir.
3. İstersen önce **Değişiklikleri şimdi gönder** ile çalıştır. **Otomatik gönderimi aç**, bu hesabın tüm desteklenen yerel kayıtlarını ve yerel silmelerini uygulama açıkken gönderir.
4. Son işlem sonucu, bekleyen istekler ve sunucunun reddettiği istek sayısı aynı bölümde gösterilir. Reddedilen isteği aşağıdaki listeden inceleyip kaldır; bulut kopyasını karşılaştırmadan üzerine yazılmaz.

Yeni Supabase migration yok; önceki 0006–0009 kurulumu gereklidir. Yeni dağıtım EXE’si üretilmedi. Hesap ayarı SQLite’ta saklanır ve ilk kez **kapalıdır**. Uygulama kapalıyken işletim sistemi servisi çalışmaz. API/Supabase kapalıysa yerel çalışma devam eder, gönderimler korunur.

## Gönderim davranışı

Görevlerin create/rename/complete/delete kuyruğu; not, proje, hedef, etkinlik, finans, bütçe ve görev planı gönderimleri aynı koordinatörde yürür. Tek hesap için aynı anda bir koordinatör çalışır. Elle gönderim ve arka plan aynı operation ID için tek HTTP/makbuz işlemini paylaşır.

Normal aralık 30 saniye; ağ geri geldiğinde veya uygulama odaklandığında tekrar kontrol edilir. Hatalarda bekleme kademeli olarak en fazla 5 dakikaya çıkar. Çıkış/hesap değişiminde ağ isteği iptal edilir; diskteki niyet silinmez. Otomatik gönderim kapatılırken başlamış isteğin sonucu belirsiz kalabilir; tekrar açıldığında aynı kimlikle denenir.

Bir tur en fazla 100 gönderim ve 10 yerel sayfa işler. Sayfa konumu sonraki tura taşınır; uygulama yeniden açıldığında tarama baştan başlar. Değişmemiş içerik doğrulanmış merkezi snapshot ile karşılaştırılıp atlanır. Her yerel tuş vuruşu ayrı bir ağ olayı değildir: SQLite’taki son kalıcı durum taranır, gönderim öncesi digest tekrar denetlenir ve istek diskte dondurulur. Başarı sonrası yerel yeni düzenlemeler korunur ve sonraki taramada alınır. İlk kez buluta gitmeden oluşturulup silinen bir kayıt için gereksiz bulut kaydı oluşturulmaz.

Gönderim kuyruğu `cloud-inbox.sqlite3` içindedir; dosya silinebilir önbellek değildir. Şema 4, mevcut işlem kimliklerini değiştirmeden hesap ayarı ve indirme tamamlanma/kurtarma bilgisini ekler. Ana SQLite şeması 14’tür. Uygulama dışından dosya silme/disk kaybı kurtarması bu mekanizmanın kapsamı değildir.

## Görev planı

Görevin proje, tarih ve öncelik alanları `/api/v1/workspace/taskPlan/{id}/operations` üzerinden update edilir. Görev önce oluşturulmuş, bağlı proje önce buluta gönderilmiş/uygulanmış olmalıdır. Henüz hazır olmayan bağımlılık sonraki taramaya bırakılır.

Plan, görev başlığı ve tamamlanmasıyla **aynı revision zincirini** kullanır. Plan niyeti varken aynı görevin başlık/tamamlanma/silme gönderimi hazırlanamaz; görev işlemi varken plan hazırlanamaz. Planın kendi yerel alanları ağ sırasında düzenlenebilir; makbuz bunları eski değerlerle ezmez. Başlık/tamamlanma makbuzları da yalnızca gerçekten gönderilmiş alanların merkezi snapshot’ını günceller.

Kesin 409 workspace_conflict ve bilinen 404 workspace_not_found/task_project_not_found yanıtları ret olarak saklanır. Bu SQL yolları önce eski makbuzu kontrol ettiğinden başarılı eski işlemi iptal etmez. Bilinmeyen hata, operation_conflict, okunamayan cevap ve ağ kesintisi sonucu belirsiz kalır; otomatik iptal edilmez.

## Yedekten dönüş

Geri yükleme, görev veya diğer modüllerde sonucu belirsiz istek varken reddedilir. Geri yüklemeden sonra tüm gönderimler kilitli kalır.

1. **Güvenlik yedeği al ve karşılaştırmayı başlat**: mevcut durum şifreli yedeklenir; eski görev gönderim geçmişi ve merkezi sürüm bağları yeni bulut durumundan kurulmak üzere temizlenir. Yerel iş kayıtları değişmez. Otomatik gönderim kapanır, bulut aynası baştan indirilir. Kesinti olursa düğmeyle kaldığın yerden devam edilir.
2. Önizlemede bulut kayıt sayısı, farklar ve yaklaşık yalnızca yerel kayıt sayısı gösterilir. Ayrıntılar mevcut karşılaştırma bölümündedir. **BULUTU ESAS AL** onayı, bulutta bulunan kayıtlar için bulut sürümünü kullanır; bulutta silinen kayıtları yerelden kaldırır. Yalnızca yerel kayıtlar korunur; silinmiş projeye bağlı yerel görevlerin yalnızca proje bağı kaldırılır. Eski yerel içerik güvenlik yedeğinde kalır. Bu yol otomatik alan birleştirmesi veya “bütün eski yerel içeriği buluta zorla yaz” işlemi değildir.
3. **Uzlaştırmayı bitir ve gönderim kilidini aç**: bulut yeniden okunur. Yeni fark varsa işlem durur. Tam indirilmiş, en fazla 120 saniyelik bulut durumu ve değişmemiş yerel/cloud digest gerekir. Karşılaştırılan tüm kayıtlar eşleşince merkezi bağlar ve yalnızca yerel görevlerin create kuyruğu tek ana SQLite transaction’ında kurulur, kilit kaldırılır. Otomatik gönderimi ayrıca tekrar açabilirsin.

Toplu bulut uygulamasından önce tek güvenlik yedeği alınır; proje/görev bağımlılıkları ve bütçe anahtarları dikkate alınır. Bir kayıt uygulanamazsa bütün toplu yerel değişiklikler geri alınır. Sunucuya bu kurtarma adımlarında yazılmaz. İndirme tamamlanmadan veya sonradan veri değişmişken kilidi açan kestirme komut yoktur.

## Doğrulama ve sınırlar

61 native depolama testi geçti; değişiklik sonrası beş yeni akış testi ayrıca geçti. TypeScript/Vite build, 42 oturum/HTTP testi ve 7 koordinatör testi geçti. Testler geçici sentetik SQLite/DPAPI verisi ve mock HTTP kullanır; bu turda canlı Supabase veya iki gerçek cihaz üzerinde test yapılmadı.

Bu üç akış tamamlandı; Paket 1’in tamamı ve ürünün bütün modülleri tamamlanmış sayılmaz. Otomatik bulut indirme/alan birleştirme, taşınabilir yedek, outbound dosyasını kapsayan disk/profil kaybı kurtarması ve iki gerçek istemcinin kabul doğrulaması ayrı kalan işlerdir. Mevcut DPAPI yedeği aynı Windows profiline bağlıdır.
