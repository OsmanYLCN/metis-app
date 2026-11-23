> Güncelleme: elle gönderim eklendi. cloud-inbox.sqlite3 artık outbound işlem kayıtlarını da içerdiği için silinebilir önbellek değildir. [Güncel gönderim kapsamı ve yedek sınırları](manual-cloud-upload.md).

# Masaüstünde bulut indirme ve karşılaştırma

## Kullanım

Yeni Supabase SQL yok. Önceki 0006–0009 kurulumu ve yerel API çalışıyor olmalı. Native komutlar eklendiği için açık geliştirme uygulamasını kapatıp `npm.cmd run desktop` ile yeniden aç; dağıtım EXE’si üretmek gerekmez.

1. Hesabına giriş yap, **Veri ve eşitleme** ekranına gir.
2. **Bulut kayıtlarını karşılaştır → Bulut değişikliklerini al** düğmesine bas.
3. Gelen kayıtların yanında **Farkı incele** ile bu cihaz ve bulut değerlerini yan yana gör.
4. Seçtiğin bulut sürümünü yerelde kullanmak için karşılaştırma altında **BULUTU UYGULA** yaz ve **Bulut sürümünü bu cihazda kullan** düğmesine bas. Öncesinde şifreli güvenlik yedeği alınır. Bulutta silinmiş kaydı onaylamak yerel kaydı siler.
5. Devamı varsa aynı düğmeye yeniden bas. Bir çalıştırmada en fazla 10 sayfa/500 değişiklik alınır; liste 50 kayıtlık sayfalara ayrılır.

İndirme buluta veri göndermez ve yerel kayıtları değiştirmez. Açık onayla uyguladığın kayıt, ilgili yerel çalışma ekranında görünür; ekranı yeniden açarak listeyi yenileyebilirsin. Tam otomatik veya tüm modüllerde iki yönlü eşitleme henüz yok.

## Ekrandaki durumlar

- Aynı: karşılaştırılan içerik alanları eşit; revision/zaman damgası eşitliği aranmaz.
- Farklı: her iki tarafta kayıt var, içerik farklı. Bu tek başına çatışmanın kaynağını veya hangi sürümün doğru olduğunu belirlemez.
- Yalnızca bulutta: aynı kimlikle yerel kayıt bulunamadı. Yerelde farklı kimlikli benzer bir kayıt olabilir; otomatik kopyalanmaz.
- Bulutta silinmiş, bu cihazda duruyor: tombstone korunur; yerel kayıt silinmez.
- İki tarafta da silinmiş/yok: tombstone var, eşleşen yerel kayıt yok.

Liste buluttan alınan kimlikleri kapsar; yalnızca yereldeki kayıtların envanteri değildir. Karşılaştırma önbellekteki son durumu ve açıldığı andaki yerel veriyi gösterir; başka işlemden sonra yeniden karşılaştır. Bütçeler yerelde UUID taşımadığından ay+kategori üzerinden karşılaştırılır; bu kalıcı kimlik eşlemesi yerine geçmez.

## Depolama ve devam noktası

Native seçilen depolama klasöründe ayrı `cloud-inbox.sqlite3` bulunur. Uygulama kimliği ve şema sürümü 1 kontrol edilir; keyfi dosya yolu/SQL webview’e verilmez. Ana çalışma SQLite şeması artık 14: cloud_bindings merkezi sürüm ve son uygulanmış snapshot’ı tutar. Yedek formatı 1; şema 13 yedekleri boş cloud_bindings ile uyumlu okunur. Önbellek hesap ve Supabase projesi kapsamlıdır; her entity/ID’nin son snapshot’ını tutar, tüm geçmişi çoğaltmaz.

Bir sayfadaki güncellemeler ve cursor tek SQLite transaction’ında kaydedilir. Beklenen eski cursor uyuşmazsa yazma reddedilir; sıra boşluğu, hesap/epoch uyuşmazlığı, uyumsuz zarf veya geri giden revision ilerlemeyi durdurur. Hata bütün sayfayı geri alır. Tekrar başlatma son başarılı sayfadan devam eder. Epoch değişiminde mevcut önbelleği körlemesine sıfırlayan komut yoktur; yeniden uzlaştırma akışı ayrıca yapılacak.

Sunucu her istekte oturumu doğrular; token frontend session store dışına çıkarılmaz. Hesap/proje/oturum generation istek başında ve yanıt sonunda kontrol edilir. Çıkış sonrası geç yanıt kullanılmaz. İndirme 20 saniyelik istek sınırı, 8 MiB HTTP gövde sınırı, native 100 öğe/sayfa, 128 KiB snapshot ve hesap başına 20.000 kayıt sınırıyla durur. Cursor konumları string, native i64; JSON revision güvenli tamsayı sınırını aşarsa reddedilir.

Önbellek ana yerel SQLite gibi diskte şifreli değildir. Oturum tokenı/parola içermez fakat indirilen gerçek kayıt içeriklerini içerir. DPAPI yerel yedeğe dahil edilmez: buluttan yeniden kurulabilen ayrı karşılaştırma verisidir. Yerel yedekten dönüş recovery_guard kilidini kaldırmaz; geri yüklenmiş yerel veriyi bulutla karşılaştırmak mümkündür.

## Onaylı yerel uygulama

Görev/not/proje/hedef/etkinlik/finans/bütçe kayıtları oluşturulabilir, mevcut kayıt bulut içeriğiyle değiştirilebilir veya tombstone onaylanarak silinebilir. Native katman tam alan kurallarını yeniden doğrular. Karşılaştırmadaki yerel içerik ve bulut snapshot digest’i transaction içinde yeniden karşılaştırılır; değişmiş önizleme reddedilir. Aynı sürüm zaten uygulanmışsa işlem tekrar yazmaz.

Bulut önbelleği kilitli tutulurken yerel kayıt ve cloud_bindings aynı yerel transaction’da kaydedilir. Önce, aynı transaction’ın gördüğü mevcut hesabın verisi DPAPI şifreli güvenlik yedeğine yazılır. Yedek oluşturulamıyorsa kayıt değişmez. Başarısız transaction geri alınır; oluşmuş güvenlik yedeği korunabilir. İnbox değişmez, yeni gönderim operasyonu üretilmez.

Yerel revision merkezi revision’dan ayrıdır. Yeni yerel kayıtların teknik oluşturma zamanları yerel eklenme anıdır; iş tarihleri (hedef/görev/etkinlik/finans) buluttan korunur. Merkezdeki özgün zamanlar cloud_bindings snapshot’ında kalır. Bu sürüm zaman damgalarını bütünüyle koruyan taşıma aracı olarak sunulmaz.

Görevlerde bekleyen/çatışan gönderim varsa veya bilinen merkezi sürüm önbellekten ilerideyse uygulama durur. İlişkili proje önce aynı hesaba yerelde eklenmiş olmalı. Yerelde bağlı görevleri olan proje silinemez; önce görevleri ayır. Başka hesaptaki aynı ID üzerine yazılmaz. Bütçede başka aktif bulut kimliğine bağlanmış aynı ay/kategori sessizce değiştirilmez.

Buluttan gelen görevlerin revision’ı gerçek bağ olarak tutulur; sahte gönderim makbuzu oluşturulmaz. Sonraki başlık değişikliği create yerine rename olarak mevcut görev kuyruğuna girer; tamamla/sil işlemleri mevcut merkezi sürümü kullanır. Görev planı ve diğer modüllerin yerel düzenlemeleri henüz otomatik yüklenmez. Güvenlik yedeğinden geri dönüş mevcut recovery_guard gönderim kilidini korur.

## Kalan işler

Diğer modüllerin atomik gönderim kuyruğu, ilk kimlik eşlemesini toplu uzlaştırma, üç yönlü çatışma tespiti, “yerel sürümü buluta gönder” seçimi ve recovery_guard kaldırma kaldı. Şu an yalnızca açıkça seçilen bulut kopyasını yerelde kullanma var; otomatik en-yeni-kazanır birleştirmesi veya toplu ezme yok.

## Kontroller

TypeScript/Vite build geçti. İlgili oturum dosyasındaki 35 test geçti; yeni testler hesap/proje bağı, gecikmiş yanıt ve cursor sıfırlama hatasını kapsar. İki native inbox testi gerçek Windows SQLite üzerinde tüm domain şekillerini, yeniden açma, atomik rollback/cursor, hesap ayrımı, yerel verinin değişmemesi, bütçe doğal anahtarı ve fark durumlarını doğruladı. Diğer 61 native test bu değişiklikte tekrar çalıştırılmadı. Native test derlemesinde incremental cache hard-link uyarısı vardı; dosyalar kopyalanarak derleme tamamlandı. Gerçek Supabase ile indirme ve görsel UI denemesi yapılmadı. Dağıtım EXE’si üretilmedi.

2026-11-23 devamı: şema 14 geçişi, eski şema 13 yedek okuması, içe aktarımda gönderim üretmeme ve görev revision bağlantısı dahil 64 native test önceki çalışmada geçti. Son eklenen önizleme/silme/güvenlik yedeğinden dönüş testiyle inbox grubu ayrıca çalıştırıldı. Storage bridge 6 test geçti; frontend build geçti. Canlı kullanıcı verisi üzerinde uygulama yapılmadı; dağıtım EXE’si üretilmedi.
