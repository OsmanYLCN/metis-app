# ADR-0002 — Yerel SQLite temeli

Tarih: 2026-11-04 · Durum: M0.2'de uygulandı · Hedef: Windows x64

## Sınır

Bu dilim yalnızca veritabanı dosyasının açılması, ilk şema, migration kaydı, yeniden açılış ve durum göstergesidir. Hesap, görev, finans, sync/outbox, PostgreSQL ve bulut bağlantısı eklenmez. Şimdilik yalnızca yerel depolamanın rastgele kimliği/oluşturulma zamanı ve migration geçmişi saklanır; kullanıcı hesabı veya cihaz donanımı kimliği değildir.

## Yerleşim ve erişim

Rust, Tauri'nin `app_local_data_dir()` dizini altında `storage/personal-os.sqlite3` dosyasını seçer. Windows'ta varsayılan konum `%LOCALAPPDATA%/com.personalos.desktop/storage/personal-os.sqlite3` olur. Arayüz bu yolu seçemez, dosya içeriği veya SQL gönderemez. İzinli tek uygulama komutu `local_storage_status`; yalnızca yerel `main` penceresine tanımlıdır. Genel dosya, shell, SQL veya uzak origin yetkisi verilmez. [Tauri capability modeli](https://v2.tauri.app/security/capabilities/) ve uygulama komut manifesti kullanılır.

`PERSONAL_OS_DATA_DIR` yalnızca süreç ortamından ayarlanabilen, mutlak bir geliştirme/test dizini seçeneğidir. UI'dan kabul edilmez. Native test kendine özgü `test-results/native-storage-*` klasöründe veritabanı ve WebView2 profili kullanır; normal kullanıcı veritabanını kullanmaz. Tarayıcı önizlemesi açıkça desteklenmeyen durumu gösterir; IndexedDB veya bellek içi sahte SQLite yedeği yoktur.

## SQLite sağlayıcısı

Windows'un mevcut `winsqlite3.dll` bileşeni, Windows SDK import kütüphanesi üzerinden bağlanır. [Microsoft bu bileşeni Windows'un sistem SQLite kütüphanesi olarak belgeler](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/custom-versions). Bu ortamda dosya sürümü 3.53.4'tür. SQL uzantısı yüklenmez.

İlk düşünülen `rusqlite`/bundled SQLite paketi ve npm Tauri API paketi, bu oturumun ağ/izin politikası yeni indirmeyi reddettiği için eklenemedi. Bunun yerine mevcut Windows SQLite'ı için küçük, özel bir RAII adaptörü ve Tauri'nin belgelenmiş [global API köprüsü](https://v2.tauri.app/reference/javascript/api/namespacecore/) kullanıldı. Yeni indirilen bağımlılık yoktur. `serde` ve `sha2` daha önce kilit dosyasında bulunan, önbellekteki paketlerden doğrudan bağımlılığa alındı.

Bu seçim SQL dosya formatını veya backend mimarisini değiştirmez. Ancak SQLite motor sürümü Windows güncellemelerine bağlıdır; uygulama kendi motor sürümünü paketlemez. Adaptör şu an Windows'a özeldir. Android/Expo daha sonra kendi SQLite adaptörünü kullanacak. Daha geniş bir masaüstü hedefi veya sabit motor sürümü gerektiğinde, iç adaptörün `rusqlite` gibi bir sağlayıcıya geçmesi ayrı bir ADR ile değerlendirilecek. Mevcut standart SQLite dosyaları bu değişiklik için yeniden tasarlanmak zorunda değildir.

## Veri bütünlüğü

- `BEGIN IMMEDIATE` transaction'ı şemayı, ilk temel kaydı, migration günlüğünü ve `user_version` güncellemesini tek atomik işlemde tutar.
- İlk SQL dosyası `0001_local_foundation.sql`; migration adı, sürümü, SHA-256 özeti ve uygulanma zamanı kaydedilir. Satır sonları özet hesaplamadan önce LF'e normalize edilir.
- `application_id` dosyayı Personal OS veritabanı olarak ayırt eder. Yeni ve boş dosya dışında sürümsüz bir dosya benimsenmez.
- `quick_check`, günlük tutarlılığı ve temel kaydın varlığı doğrulanır. Bozuk/yabancı/değiştirilmiş veya daha yeni şema hata verir; otomatik silme, sıfırlama veya downgrade yapılmaz.
- Migration hatası rollback ile geri alınır. SQLite transaction davranışı için [resmi belge](https://www.sqlite.org/lang_transaction.html) esas alınır.
- 1,5 saniyelik busy timeout, `foreign_keys=ON`, `trusted_schema=OFF`, `synchronous=FULL`; başarılı şema doğrulamasından sonra WAL kullanılır.
- Bağlantı her bloklayan Rust işi içinde açılıp kapatılır. C handle'ları özel RAII sahiplerindedir, iş parçacıkları arasında taşınmaz; sonuç metinleri statement kapanmadan kopyalanır.
- Arayüze dosya yolu veya ham SQLite hata metni verilmez; sınırlı hata kodları döner. Arayüz yanıt bekleme süresini 6 saniyeyle sınırlar. Bu UI zaman aşımı, sürmekte olan native işlemi iptal etmez.

## Bilinen sınırlar

SQLite dosyası bu aşamada şifrelenmez. Kimlik token'ı, parola, kişisel finans/not içeriği veya başka hassas veri yazılmaz. Güvenli secret saklama, gerçek kullanıcı verisi, yedekleme/geri yükleme, migration yükseltmesi ve sync/outbox daha sonraki dilimlerdir. Sistem/DB dosyasını bir uygulama hatasını gidermek için silmek önerilmez.

Sonraki öneri M0.3: hesap/oturum katmanının bağlantısız sözleşmesi ve güvenli yapılandırma temeli. Gerçek servis hesabı bağlama ve kimlik doğrulama, ayrıca kontrollü bir dilimde ele alınacak. Hiçbir sonraki dilim bu ADR ile otomatik yetkilendirilmez.
