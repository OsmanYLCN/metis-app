# Paket 1 — Merkezi veri, eşitleme ve veri koruma

Durum (25 Kasım 2026): kod çalışmaları ve erişilen ortamdaki doğrulamalar tamamlandı. Canlı Supabase şema/yetki hazırlığı da doğrulandı. İki fiziksel cihazdaki uçtan uca kullanıcı kabulü yapılmadığından paket koşulsuz kapanmış sayılmaz. Paket 2’ye geçilmedi. Güncel kanıtlar: [kabul kaydı](package-1-acceptance.md). Aşağıdaki eski bölümler kendi tarihindeki durumu anlatır.

## Tamamlanan ilk bölüm — v0.49.0

- Hesap kapsamlı yerel snapshot: görevler ve planlama, not/proje, hedef, finans, etkinlik, bütçe, bildirim tercihleri ve görev gönderim günlüğü.
- DPAPI ile aynı Windows profiline bağlı şifreli dosya. Kimlik bilgileri yedeğin dışında.
- Kayıt sayılarıyla önizleme, current/backup digest doğrulaması, mevcut durumun otomatik güvenlik yedeği.
- Tek transaction içinde restore, başka hesaplara dokunmama, başarısızlıkta rollback.
- Sonucu belirsiz, başlamış bulut işlemi varken restore reddi.
- Restore sonrasında kalıcı recovery_guard; native gönderim hazırlığı/ack yollarında kontrol.
- Veri ve eşitleme ekranı, bekleyen/çatışan/sonucu belirsiz görev işlemleri ve elle gönderim.
- Güncel README; eski README arşivlendi. Şema sürümüne sabitlenmiş eski kontroller düzeltildi.

## Tamamlanan ikinci bölüm — merkezi görev değişiklik akışı

- 0006 migration: mevcut görevlerin başlangıç snapshot’ı, hesap başına transaction içinde ilerleyen sayaç, değişmez günlük, silme kayıtları.
- Mevcut görev writer ve operation ID tekrar davranışı korunur; yeni bağımsız görev kaynağı yok.
- `/api/v1/sync/changes`: JWT hesap doğrulama, sınırlı sayfalar, hesap/epoch/konum cursor’ı, read-only RLS, tek snapshot içinde okuma.
- Yerel PGlite + gerçek Npgsql/HTTP kontrolleri ve mevcut writer regresyonu geçti; .NET Release build sıfır hata/uyarı.
- Canlı migration uygulanmadı. [0006 kurulumu ve sözleşme](change-feed.md).
- Bu bölüm sunucuda görev değişikliklerini okumayı sağlar. Masaüstüne uygulama ve diğer modüller henüz yok.

## Tamamlanan üçüncü bölüm — merkezi not/proje yazma

- Kullanıcı 0006 kurulumunu tamamladığını doğruladı.
- 0007: not/proje tabloları, RLS, kısıtlı yazma fonksiyonu, sürüm çatışması, kalıcı işlem makbuzu, tombstone.
- Yeni authenticated workspace operation API; alan ve istek boyutu doğrulaması.
- Not/projeler mevcut ortak değişiklik günlüğüne atomik olarak girer.
- Release build ve sentetik SQL/Npgsql/HTTP kontrolleri geçti. Canlı 0007 uygulanmadı.
- [Kurulum ve sözleşme](central-workspace.md). İstemci bağlantısı ve kalan merkezi modüller henüz yok.

## Tamamlanan dördüncü bölüm — dört merkezi modül

- 0008: hedef/takvim/finans/bütçe için sıkı alan doğrulaması, revision, işlem makbuzu, tombstone ve ortak değişiklik akışı.
- Finans kuruş tam sayısı, TRY sınırı; bütçe ay/kategori benzersizliği. Tarih/saat/ilerleme doğrulaması hem API hem SQL tarafında.
- Mevcut workspace operation API genişletildi; not/proje yolu korundu.
- Release build + 59 kontrol grubu ve SQL doğrulaması geçti (2026-11-22).
- [0008 kurulumu ve sözleşme](central-domains.md). Canlı 0008 uygulanmadı; 0007’nin kullanıcı tarafından uygulanması ayrıca doğrulanmadı.
- Yerel şema, yedek formatı ve ekran davranışı değişmedi. Bu kayıtlar henüz masaüstünden otomatik gönderilmiyor.

## Tamamlanan beşinci bölüm — görev planı ve proje ilişkisi

- 0009 mevcut merkezi görevlere proje/tarih/öncelik alanları ekler; yeni görev kaynağı oluşturmaz.
- Sürüm bağlı plan operasyonu, tekrar makbuzu, hesap/proje doğrulaması.
- Proje silme görevleri koruyup yalnızca bağı kaldırır; görev ve proje değişiklikleri atomik günlüğe girer.
- Task GET ve delta snapshot’ları planı taşır; eski şema okuması varsayılanlarla uyumlu.
- Release build ve gerçek yerel SQL/Npgsql/HTTP yazma-okuma kontrolleri geçti.
- [0009 kurulumu ve sözleşme](central-task-planning.md). Canlı migration uygulanmadı.

## Tamamlanan altıncı bölüm — masaüstünde bulut önbelleği ve karşılaştırma

- Yedi entity türü için oturuma bağlı, iptal edilebilir sayfalı bulut okuma.
- Ayrı native inbox SQLite: hesap/proje kapsamı, atomik sayfa+cursor, yeniden başlatma sonrası devam, sıra/epoch/revision doğrulaması.
- Veri ve eşitleme ekranında indirme, 50 kayıtlık karşılaştırma ve alan alan fark görüntüsü.
- Yerel veriye uygulama veya yeni bulut yazması yok. Farklar henüz üç yönlü çatışma tespiti sayılmaz.
- Ana SQLite şeması/yedek formatı değişmedi. Inbox yeniden indirilebilir ve yedeğin dışında.
- Frontend build, ilgili 35 session testi ve 2 native inbox testi geçti. [Kullanım ve sınırlar](cloud-inbox.md).

## Tamamlanan yedinci bölüm — onaylı yerel uygulama

- Yedi tür için bulut kopyasını açık onayla yerelde oluşturma/değiştirme/silme.
- Native alan/bağ/hesap doğrulaması, eski önizleme reddi, işlem öncesi şifreli güvenlik yedeği.
- Ana SQLite şema 14: cloud_bindings; yerel kayıt ve merkezi sürüm bağı atomik. Ana şema 13 yedeklerine uyumluluk.
- Gelen kayıt tekrar gönderilmez; ithal görevin başlık değişikliği merkezi revision ile rename olur.
- Pending görev, eksik proje, bağlı proje silme ve bütçe kimlik çatışmalarında işlem reddi.
- Tam otomatik eşitleme, diğer modüllerin gönderimi ve recovery_guard uzlaştırması hâlâ eksik.

## Tamamlanan sekizinci bölüm — altı modülde elle create/update gönderimi

- Yerel kayıt listesi ve kullanıcı seçimiyle not/proje/hedef/etkinlik/finans/bütçe gönderimi.
- Diskte dondurulmuş işlem kimliği/payload; oturum bağlı HTTP, sıkı makbuz doğrulaması.
- Makbuz yerel yeni düzenlemeyi ezmez; merkezi revision bağı güncellenir.
- Inbox şema 2 artık outbound niyetlerini içerir; silinebilir önbellek değildir. Bu dosyanın yedek kapsamına dahil edilmesi kalan iştir.
- Bu bölümün silme ve ret çözümü eksikleri aşağıdaki dokuzuncu bölümde ele alındı. [Kullanım ve sınırlar](manual-cloud-upload.md).

## Tamamlanan dokuzuncu bölüm — onaylı silme ve kesin ret çözümü

- Altı modülde bilinen merkezi sürümü olan yerel silmeleri listeleme; ayrı kullanıcı onayıyla delete gönderimi.
- Silme isteğinin kalıcı kimlikle tekrarı; makbuz işlenirken yeniden oluşturulmuş yerel kayıt korunur.
- Yalnızca oturum bağlı, doğrulanmış workspace_conflict yanıtından sonra isteği reddedildi olarak işaretleme ve kullanıcı seçimiyle kaldırma. Sonucu belirsiz istek iptal edilmez.
- Ret kaldırma sonrası mevcut bulut karşılaştırma/uygulama yoluyla elle uzlaştırma; otomatik üzerine yazma veya birleştirme yok.
- Inbox/outbound şema 3; eski kayıtların işlem kimliği korunur. Yeni Supabase SQL veya dağıtım EXE’si yok.
- Doğrulama: 7 native inbox/outbound testi, 40 oturum/HTTP testi, TypeScript/Vite build. Canlı kullanıcı verisi kullanılmadı.

## Tamamlanan onuncu bölüm — gönderim, plan ve kurtarma birlikte

- Hesap bazında kalıcı aç/kapat ayarı; uygulama açıkken 30 saniyelik gönderim, ağ/odak dönüşünde kontrol ve hatalarda kademeli bekleme.
- Tek koordinatör; elle/arka plan ortak makbuz; değişen son kalıcı durumun taranması ve HTTP öncesi immutable outbound isteği. Yarım kalan istek restart sonrası aynı kimlikle denenir.
- Görev planı gerçek taskPlan endpoint’ine bağlı; görev ve proje bağımlılığı ile ortak revision kilidi korunur.
- Geri yükleme sonrası tam/taze bulut indirme, önizleme, tek yedek + atomik toplu bulut uygulama ve yalnızca eşleşme doğrulanınca guard kaldırma.
- Yalnızca yerel kayıtlar korunur; görev kuyruğu yeni merkezi duruma göre yeniden kurulur. Yeni SQL veya dağıtım EXE’si yok.
- [Kullanım ve tasarım sınırları](automatic-sync-recovery.md).

## Tamamlanan on birinci bölüm — gelen birleştirme ve iki izole istemci

- Ayrı hesap tercihiyle otomatik alma; gönderim öncesi ve sonrası indirme/birleştirme.
- Ortak snapshot üzerinden bağımsız alanların birleştirilmesi; finans/bütçe, silme ve aynı alan çakışmaları için kalıcı engel ve kullanıcı çözüm ekranı.
- Başlamamış görev niyetlerinin yeni revision ile kurulması; bilinmeyen HTTP sonucuna dokunmama; doğrulanmış retlerin ayrılması.
- Ayrı süreç ve SQLite klasörleriyle iki native istemci; gerçek migration SQL/PGlite üzerinde yedi senaryo geçti.
- Bu doğrulama iki fiziksel cihaz veya canlı Supabase doğrulaması değildir. [Kullanım, kurallar ve test sınırları](incoming-merge.md).

## Tamamlanan on ikinci bölüm — taşınabilir kurtarma ve bütünleşik kabul

- Parolalı taşınabilir yedek; tüm yerel hesaplar, ana SQLite ve ayrı inbox/outbound günlüğü, makbuzlar, sürüm bağlantıları ve çakışmalar birlikte korunur.
- Önizleme, doğrulanan yeni veri alanı, yeniden başlatmada atomik seçim, eski dosyaları koruma; bozuk eski SQLite ve yeni Windows profili için kurtarma yolu.
- Oturum ve servis parolaları yedeğe dahil değildir; otomatik alma/gönderme kapalı döner.
- Gerçek PostgreSQL’de çok oturumlu commit sırası, rollback, eşzamanlı tekrar, revision çatışması ve RLS kontrolleri geçti.
- Yedi modül iki HTTP istemcisinde; iki native SQLite süreci gerçek API ve PostgreSQL üzerinden yedi senaryoda doğrulandı.
- Canlı Supabase’e yalnızca metadata okuması yapıldı: TLS, kısıtlı roller, kurulum eşleşmesi, 0001–0009 ve workspace/taskPlan yetkileri hazır. Yeni SQL uygulamak gerekmiyor.
- [Taşınabilir kurtarma rehberi](portable-recovery.md), [kanıt ve kabul kaydı](package-1-acceptance.md).

## Kapanışta kalan doğrulama ve tasarım sınırları

İki fiziksel cihazla canlı Supabase üzerinden son kullanıcı kabulü bekleniyor. İki ayrı native süreç aynı bilgisayarda doğrulandı; bu, ikinci fiziksel cihazın ağı/Windows profili üzerinde test yapıldığı anlamına gelmez.

Mevcut davranışlar: son kalıcı durum taranır; her tuş vuruşu ayrı olay olarak arşivlenmez. Çakışmada kayıt düzeyinde yerel/bulut seçimi vardır; daha ayrıntılı alan seçimi yoktur. Silinmiş kimlik diriltilmez, gerektiğinde yeni kayıt oluşturulur. Eski DPAPI yedeğinden dönüşte bulutu esas alan uzlaştırma kullanılır; yeni taşınabilir yedek iki günlüğü ve ortak snapshot’ı birlikte geri getirir. Bu sınırlar saklanmamalı veya tamamlanmış özellik gibi gösterilmemelidir.

## Paketin bitiş ölçütü

Tüm hedeflenen modüller iki istemci arasında veri kaybetmeden güncellenir; bağlantı kesilmesi ve tekrarlı işlemler yeni kayıt üretmez; hesaplar birbirinin verisine erişmez; yerel/sunucu çatışması görünürdür; geri yükleme sonrası uzlaştırma çalışır. Kritik durumlar test edilmeden paket tamamlandı denmez.

## Sınırlar ve doğrulama

Masaüstüne buluttan ayrı önbelleğe indirme ve karşılaştırma hazır; onaylı yerel uygulama ve otomatik gönderim hazır; isteğe bağlı iki yönlü akış hazır; çakışmalar açık kullanıcı seçimi bekler. Canlı kurulumda 0001–0009 bu oturumda doğrulandı; yeni SQL gerekmiyor. Canlı kullanıcı verisi üzerinde restore/sync testi yapılmaz; sentetik geçici veriler kullanılır. Dağıtım EXE’si yok.

Mevcut yedek formatı 1, ana şema 14. Şema 13 yedekleri boş bulut bağlantılarıyla okunur. Sonraki şemalarda uyumluluk korunmalı. Ayrı taşınabilir format METISPB1, kullanıcı parolasıyla şifrelenir ve ana şema 14 / inbox şema 5 kapsamını birlikte taşır.

Doğrulama (2026-11-19): TypeScript/Vite build geçti; native depolama + DPAPI 61 test geçti; storage bridge 6 test geçti. Tam native kontrolün nedeni veri değiştiren restore ve şema geçişidir. Testler yalnızca geçici sentetik veri kullandı; canlı hesap verisiyle geri yükleme yapılmadı.

Bu bölümün doğrulaması (2026-11-23): 61 native depolama testi, son native düzeltmeden sonra 5 hedefli akış testi, TypeScript/Vite build ve toplam 49 oturum/koordinatör testi. Canlı hesap kullanılmadı.
