# Masaüstünde bulut indirme ve karşılaştırma

## Kullanım

Yeni Supabase SQL yok. Önceki 0006–0009 kurulumu ve yerel API çalışıyor olmalı. Native komutlar eklendiği için açık geliştirme uygulamasını kapatıp `npm.cmd run desktop` ile yeniden aç; dağıtım EXE’si üretmek gerekmez.

1. Hesabına giriş yap, **Veri ve eşitleme** ekranına gir.
2. **Bulut kayıtlarını karşılaştır → Bulut değişikliklerini al** düğmesine bas.
3. Gelen kayıtların yanında **Farkı incele** ile bu cihaz ve bulut değerlerini yan yana gör.
4. Devamı varsa aynı düğmeye yeniden bas. Bir çalıştırmada en fazla 10 sayfa/500 değişiklik alınır; liste 50 kayıtlık sayfalara ayrılır.

Bu işlem buluta veri göndermez ve yerel kayıtları değiştirmez. Yerel çalışma ekranlarında yeni bulut kaydının otomatik görünmesini bekleme. Bu adım tam eşitleme değil, kalıcı indirme ve güvenli karşılaştırmadır.

## Ekrandaki durumlar

- Aynı: karşılaştırılan içerik alanları eşit; revision/zaman damgası eşitliği aranmaz.
- Farklı: her iki tarafta kayıt var, içerik farklı. Bu tek başına çatışmanın kaynağını veya hangi sürümün doğru olduğunu belirlemez.
- Yalnızca bulutta: aynı kimlikle yerel kayıt bulunamadı. Yerelde farklı kimlikli benzer bir kayıt olabilir; otomatik kopyalanmaz.
- Bulutta silinmiş, bu cihazda duruyor: tombstone korunur; yerel kayıt silinmez.
- İki tarafta da silinmiş/yok: tombstone var, eşleşen yerel kayıt yok.

Liste buluttan alınan kimlikleri kapsar; yalnızca yereldeki kayıtların envanteri değildir. Karşılaştırma önbellekteki son durumu ve açıldığı andaki yerel veriyi gösterir; başka işlemden sonra yeniden karşılaştır. Bütçeler yerelde UUID taşımadığından ay+kategori üzerinden karşılaştırılır; bu kalıcı kimlik eşlemesi yerine geçmez.

## Depolama ve devam noktası

Native seçilen depolama klasöründe ayrı `cloud-inbox.sqlite3` bulunur. Uygulama kimliği ve şema sürümü 1 kontrol edilir; keyfi dosya yolu/SQL webview’e verilmez. Ana çalışma SQLite şeması 13 ve yedek formatı değişmedi. Önbellek hesap ve Supabase projesi kapsamlıdır; her entity/ID’nin son snapshot’ını tutar, tüm geçmişi çoğaltmaz.

Bir sayfadaki güncellemeler ve cursor tek SQLite transaction’ında kaydedilir. Beklenen eski cursor uyuşmazsa yazma reddedilir; sıra boşluğu, hesap/epoch uyuşmazlığı, uyumsuz zarf veya geri giden revision ilerlemeyi durdurur. Hata bütün sayfayı geri alır. Tekrar başlatma son başarılı sayfadan devam eder. Epoch değişiminde mevcut önbelleği körlemesine sıfırlayan komut yoktur; yeniden uzlaştırma akışı ayrıca yapılacak.

Sunucu her istekte oturumu doğrular; token frontend session store dışına çıkarılmaz. Hesap/proje/oturum generation istek başında ve yanıt sonunda kontrol edilir. Çıkış sonrası geç yanıt kullanılmaz. İndirme 20 saniyelik istek sınırı, 8 MiB HTTP gövde sınırı, native 100 öğe/sayfa, 128 KiB snapshot ve hesap başına 20.000 kayıt sınırıyla durur. Cursor konumları string, native i64; JSON revision güvenli tamsayı sınırını aşarsa reddedilir.

Önbellek ana yerel SQLite gibi diskte şifreli değildir. Oturum tokenı/parola içermez fakat indirilen gerçek kayıt içeriklerini içerir. DPAPI yerel yedeğe dahil edilmez: buluttan yeniden kurulabilen ayrı karşılaştırma verisidir. Yerel yedekten dönüş recovery_guard kilidini kaldırmaz; geri yüklenmiş yerel veriyi bulutla karşılaştırmak mümkündür.

## Henüz yapılmayanlar

Snapshot’ı yerel tablolara uygulama, diğer modüllerin atomik gönderim kuyruğu, ilk veri/kimlik eşlemesi, üç yönlü çatışma tespiti, kullanıcı çözüm kararı ve recovery_guard kaldırma yok. Şu anki native snapshot kontrolü karşılaştırma alanlarını ve akış zarfını doğrular; ileride uygulama aşamasında bütün alan kuralları, ilişkiler ve yerel değişmezler ayrıca kontrol edilmelidir. Ekranda henüz “bulutu kullan/yereli kullan” işlemi yoktur.

## Kontroller

TypeScript/Vite build geçti. İlgili oturum dosyasındaki 35 test geçti; yeni testler hesap/proje bağı, gecikmiş yanıt ve cursor sıfırlama hatasını kapsar. İki native inbox testi gerçek Windows SQLite üzerinde tüm domain şekillerini, yeniden açma, atomik rollback/cursor, hesap ayrımı, yerel verinin değişmemesi, bütçe doğal anahtarı ve fark durumlarını doğruladı. Diğer 61 native test bu değişiklikte tekrar çalıştırılmadı. Native test derlemesinde incremental cache hard-link uyarısı vardı; dosyalar kopyalanarak derleme tamamlandı. Gerçek Supabase ile indirme ve görsel UI denemesi yapılmadı. Dağıtım EXE’si üretilmedi.
