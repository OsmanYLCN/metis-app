# ADR-0008: Hesaba göre ayrılan yerel görevler

Durum: Kabul edildi — M0.8, 2026-11-07.

## Kapsam

Windows uygulamasında görev başlığı oluşturma, listeleme, tamamlama ve yeniden açma. Liste 100 kayıtlık sayfalarla gelir. Başlık 1–200 karakterdir; boş veya kontrol karakteri içeren başlık reddedilir. Düzenleme, silme, tarih, proje ilişkisi, arama ve bulut eşitlemesi ayrı dilimlerdir. Tarayıcı önizlemesinde kayıt yapılmaz.

## Veri ve işlem sınırı

SQLite migration 0002, `tasks` tablosunu ve hesap/sıralama indeksini ekler. Kimlik, proje, kullanıcı, başlık, tamamlanma durumu ve oluşturulma/güncellenme zamanları saklanır. Migration 0001 değişmez. Eski journal doğrulanır; yeni DDL, journal ve sürüm aynı işlemde uygulanır. Hata halinde geri alınır, mevcut yerel kimlik korunur. Eski uygulama sürümleri şema 2 dosyasını daha yeni şema olarak reddeder; dosyayı sıfırlamaz. Geriye migration yoktur.

Rust yalnızca `tasks_list`, `tasks_create`, `tasks_set_completed` komutlarını sunar. Dosya yolu Rust tarafından seçilir; genel SQL veya dosya erişimi açılmaz. Kullanıcı değerleri SQLite prepared statement parametrelerine bağlanır. Her işlem bağlantısını kendi blocking thread'inde açar/kapatır.

Oluşturma isteği istemcide rastgele UUID'den türetilen sabit 32 hex kimlik taşır. Aynı kimlik/hesap/başlıkla tekrar deneme aynı kaydı döndürür; farklı içerik veya hesap conflict verir. Tamamlama bir toggle komutu değil, istenen durumu yazan idempotent komuttur. Yanıt doğrulanmadan başarı veya tamamlandı görünümü gösterilmez.

## Hesap ayrımı ve güvenlik sınırı

Arayüz, API'nin doğruladığı açık oturumun UUID'sini ve yapılandırılmış Supabase proje referansını kullanır. Her sorgu ikisini birlikte filtreler. Oturum kapanınca/yenilenirken ya da hesap değişince görev bileşeni kaldırılır; taslak ve görünür liste temizlenir. Eski asenkron sonuçlar yeni hesaba uygulanmaz. Yerel kayıtlar çıkışta silinmez.

Bu **yerel veri bölümlendirmesidir**, Rust tarafında JWT doğrulaması veya kullanıcılar arasında bir güvenlik sınırı değildir: yerel renderer IPC'ye hesap kimliğini iletir. Aynı Windows hesabındaki bir süreç, SQLite dosyasını okuyabilir veya IPC'yi kendi hesabı dışında çağırabilir. SQLite görev içeriği şifrelenmez; DPAPI yalnızca hatırlanan oturum tokenı için kullanılır. Çok kullanıcılı güvenli veri izolasyonu iddiası yoktur.

Gelecekte uzak görev API'si kullanıcı kimliğini doğrulanmış JWT'den türetecek, istemciden gelen `userId` değerini yetkilendirme olarak kabul etmeyecektir. Merkezi PostgreSQL ve sync bu dilimde bağlanmaz. Yerel kayıtlar Supabase'e gönderilmez. Sunucu revision/conflict/outbox sözleşmesi ayrı ADR gerektirir.

## Çevrimdışı davranış

Geçerli açık oturum sırasında görev işlemleri ağ kullanmaz. Uygulama yeniden açıldığında mevcut kimlik akışı oturumu API/Supabase ile doğrular; çevrimdışı oturum açma eklenmedi. Oturum süresi dolarsa/yenileme başarısızsa liste kapanır. Bu sınırlama görevlerin diskten silindiği anlamına gelmez.

OFFSET sayfalama bu ilk yerel liste için yeterlidir. Başka uygulama örneği sayfalar arasında kayıt eklerse liste yenilenerek baştan okunur; eşzamanlı bulut/cursor tutarlılığı henüz tasarlanmadı.

## M0.9 eki: Başlık düzenleme ve silme

2026-11-07: `tasks_rename` ve `tasks_delete` dar kapsamlı yerel komutları eklendi; şema değişmedi. İşlem önce `BEGIN IMMEDIATE` içinde güncel başlığı okur. İstemcinin düzenleme/silme onayına esas aldığı başlık farklıysa conflict verir. Düzenlemede hedef başlık zaten mevcutsa idempotent başarı, kayıtsız görevde notFound döner. Silmede yalnızca aynı hesap/proje kaydı etkilenir; zaten bulunmayan kayıt idempotent başarıdır.

Başlık karşılaştırması tam bir revision mekanizması değildir: başlığın A→B→A değişmesi veya tamamlanma durumunun değişmesi algılanmaz. Bu yerel dilimde yalnızca başlık taslağı/onayı korunur. Merkezi eşitleme için ayrıca revision ve silme kaydı gerekecektir; mevcut fiziksel silme bulut silme protokolü olarak kullanılamaz.

Arayüz silmeyi ikinci açık onayla yapar. Taslak/sonuçlar hesap değişince kaldırılır; asenkron sonuçlar eski hesaptan yeni hesaba uygulanmaz. Hata ve zaman aşımında başarı gösterilmez; işlemin kayıp yanıtı aynı istekle tekrar denenebilir. Silme fiziksel kaydı kaldırır; diskte güvenli imha veya geri alma garantisi verilmez.
