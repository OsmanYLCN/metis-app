# Paket 1 — Merkezi veri, eşitleme ve veri koruma

Durum: devam ediyor. Kullanıcı paketi onayladı. Bu belge bir sonraki oturumun başlangıç noktasıdır; Paket 2’ye geçilmez.

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

## Devam sırası — kalan işler

1. Ortak akış görev/not/proje/hedef/takvim/finans/bütçeyi kapsıyor. Çok oturumlu PostgreSQL commit sırası doğrulaması kaldı.
2. Hedeflenen modüllerin merkezi modelleri ve yazması hazır. Merkezi proje–görev ilişkisi ve görev planlama alanları kaldı.
3. Bu modüllerin yerel değişikliklerinin atomik outbox’a alınması. Yeni sürüme geçerken mevcut kayıtları kullanıcı/cihaz sahipliğiyle uzlaştırma; kör toplu yükleme yok.
4. Delta indirme + yükleme, kayıt/cihaz cursor’ları ve kesinti sonrası devam. Sunucudan gelen değişiklik tekrar yerel gönderim kuyruğuna alınmamalı.
5. Çakışma kaydı ve kullanıcı çözüm ekranı. Özellikle finans/not verileri sessizce ezilmemeli. Silme iki yönde de taşınmalı.
6. Recovery guard yalnızca yerel yedek ve mevcut sunucu durumu karşılaştırılıp çakışmalar çözüldüğünde kaldırılmalı. Şu anda kilidi elle açan komut YOK.
7. Taşınabilir dışa aktarma, disk/profil kaybı ve bozuk SQLite için kurtarma; şu anki DPAPI snapshot bunun yerine geçmez.
8. İki ayrı istemci veri dizininde uçtan uca test: offline değişiklik, yeniden deneme, silme, aynı kaydı iki tarafta değiştirme, tekrar başlatma ve güvenlik.

## Paketin bitiş ölçütü

Tüm hedeflenen modüller iki istemci arasında veri kaybetmeden güncellenir; bağlantı kesilmesi ve tekrarlı işlemler yeni kayıt üretmez; hesaplar birbirinin verisine erişmez; yerel/sunucu çatışması görünürdür; geri yükleme sonrası uzlaştırma çalışır. Kritik durumlar test edilmeden paket tamamlandı denmez.

## Sınırlar ve doğrulama

Masaüstüne buluttan indirme veya çok modüllü eşitleme henüz yazılmadı. Sunucu değişiklik akışı için yeni 0006 SQL gerekir; yerel yedekleme bölümü için gerekmez. Canlı kullanıcı verisi üzerinde restore/sync testi yapılmaz; sentetik geçici veriler kullanılır. Dağıtım EXE’si yok.

Mevcut yedek formatı 1, şema 13 ile sınırlı. Sonraki şema artışında eski yedeği sessizce reddetmek yerine açık uyumluluk/migration yolu ele alınmalı. Taşınabilir ihracat gelecekte kullanıcı parolasıyla şifreleme gibi bağımsız anahtar yönetimi gerektirir.

Doğrulama (2026-11-19): TypeScript/Vite build geçti; native depolama + DPAPI 61 test geçti; storage bridge 6 test geçti. Tam native kontrolün nedeni veri değiştiren restore ve şema geçişidir. Testler yalnızca geçici sentetik veri kullandı; canlı hesap verisiyle geri yükleme yapılmadı.
