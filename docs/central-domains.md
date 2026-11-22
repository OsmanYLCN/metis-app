# Hedef, takvim, finans ve bütçe — merkezi kayıtlar

## Tek kurulum dosyası

Önkoşul 0007’nin başarıyla uygulanmış olmasıdır. Henüz uygulamadıysan önce [0007 rehberi](central-workspace.md).

1. Supabase → SQL Editor → New query.
2. `services/api/Database/Migrations/0008_domain_records.sql` dosyasının tamamını yapıştır ve bir kez Run de. İçinde değiştirilecek değer yok.
3. Yerel API terminalinde Ctrl+C, sonra `npm.cmd run dev:api`.

Eski migration’ları yeniden çalıştırma. Yeni hesap/anahtar/hosting yok. Bu geliştirmede canlı Supabase’e müdahale edilmedi. Mevcut görev ve not/proje kayıtları korunur. 0008 olmadan onların API’leri çalışmaya devam eder; yeni dört modül yazması 503 verir.

## API

Mevcut operation sözleşmesi genişletildi: `POST /api/v1/workspace/{kind}/{id}/operations`. Yeni kind değerleri goal/event/finance/budget. Gövde operationId/action/expectedRevision/payload; kimlikler tiresiz UUID. Create revision 0, update/delete son merkezi revision; delete payload `{}`. Kayıt, sürüm, makbuz ve ortak günlük tek transaction’da değişir. Aynı işlem tekrarında eski makbuz döner, farklı payload aynı operation ID ile kabul edilmez. Eski revision 409; başka hesap/kayıp/silinmiş kayıt update’i 404. Mevcut not/proje sözleşmesi değişmedi.

| Kind | Payload alanları | Kurallar |
| --- | --- | --- |
| goal | title, description, state, targetDate, progress | Başlık 200, açıklama 10.000 karakter; active/paused/done; tarih null veya YYYY-MM-DD; tam sayı ilerleme 0–100 |
| event | title, details, eventDate, startTime, endTime | Başlık 200, açıklama 5.000; geçerli tarih; saat null veya HH:mm; bitiş varsa başlangıç ve daha ileri saat gerekir |
| finance | title, direction, category, amountCents, entryDate, currency | income/expense; kategori 60 karakter; tutar tam sayı kuruş 1–999999999999; geçerli tarih; TRY |
| budget | month, category, limitCents, currency | YYYY-MM; kategori 60; limit tam sayı kuruş 1–999999999999; TRY |

Tüm alanlar zorunlu; opsiyonel tarih/saat açık null gönderilir. Bilinmeyen/tekrarlı payload alanı reddedilir. Başlık/kategori kırpılmış ve kontrol karakteri içermez; uzun metinde satır sonu/tab serbest. Tarihler 0001–9999, gerçek takvim günü olmalı. State ve progress bağımsızdır; sunucu hedefi kendiliğinden done yapmaz.

Takvim mevcut yerel model gibi tarih ve duvar saati saklar; UTC instant veya saat dilimleri arasında dönüşüm iddiası yok. Başlangıç olmadan bitiş, eşit/ters saat ve gece yarısını aşan etkinlik bu sözleşmede kabul edilmez. Finans direction alanı yerel finance.kind ile eşleşecektir; snapshot.kind ise entity türünü belirtir. Para float’a çevrilmez. Döviz/çoklu hesap gibi ürün genişlemeleri bu migration’da uygulanmadı.

Bütçe için hesap+ay+kategori+para birimi aktif kayıt anahtarı benzersizdir. Başka UUID ile aynı bütçe oluşturulması 409 olur. Birleştirme/sessiz üzerine yazma yok. Silinen UUID tekrar kullanılmaz; aynı doğal anahtar için yeni UUID ile yeni bütçe açılabilir. Yerelde bütçe UUID/revision taşımadığından ilk eşitlemede kimlik eşlemesi yapılması gerekir. Yerel sıfır limit=silme davranışı merkezde delete operasyonuna çevrilecek; sıfır tutarlı merkezi bütçe kaydı oluşturulmaz.

## Saklama ve erişim

`domain_records` sıkı payload CHECK doğrulamasıyla dört türü tutar; JSON serbest şema değildir. `domain_operations` değişmez işlem makbuzlarını saklar. Mevcut workspace_entries/workspace_operations ve görev tabloları ayrı kaynakları olarak kalır. Bu dört tür arasında operation ID alanı ortak, not/proje ve görev makbuzlarından ayrıdır.

Reader hesap RLS ile SELECT yapabilir. Writer tabloya doğrudan yazamaz; sabit search_path’li kısıtlı SECURITY DEFINER fonksiyonu session_user, claims, açık sahiplik ve alan kurallarını doğrular. API rol, kurulum, RLS ve doğrudan yazma yetkisi kontrollerini korur. Bütçe doğal anahtar çatışması transaction içinde 409 sonucuna çevrilir; yarım kayıt/sayaç/makbuz bırakmaz.

Ortak `/api/v1/sync/changes` entity değerleri artık task/note/project/goal/event/finance/budget. Yeni snapshot’lar payload alanları ile id/kind/revision/createdAt/updatedAt/deletedAt içerir. Hesap sayacı ve commit sıralaması aynı mekanizma üzerinden devam eder. Silme tombstone olarak kalır. Günlük ve makbuzların fiziksel temizliği bu aşamada yok; geçmiş kayıt içerikleri tutulur.

## Kapsam ve sonraki entegrasyon

Bu bölüm dört modülün merkezi yazma ve değişiklik okuma altyapısını tamamlar; ekranlardaki kayıtlar hâlâ yereldir. Masaüstünden gönderim, kalıcı indirme cursor’ı, ilk kayıt eşlemesi, çatışma çözümü ve recovery guard uzlaştırması henüz yok. Görevlerin merkezi proje/tarih/öncelik bağlantısı da sıradadır. Yerel şema/yedek formatı değiştirilmedi ve otomatik veri aktarımı yapılmadı.

## Doğrulama — 2026-11-22

Release solution build sıfır hata/uyarı. `npm.cmd run test:domains`: önceki not/proje ve yeni dört modülün gerçek Npgsql+JWT/HTTP hattı; toplam 59 kontrol grubu (mevcut kimlik/görev kontrolleri dahil). Ayrıca SQL tarafında bağımsız alan doğrulaması, sahte/eksik hesap, doğrudan yazma reddi, rollback, sıralı değişiklikler, değişmez snapshot, RLS ve makbuz sayıları test edildi. Testler geçici sentetik PGlite verisinde çalıştı. Gerçek iki oturumlu PostgreSQL yarış testleri ve iki cihaz eşitleme kabulü hâlâ Paket 1 bitiş işidir. Frontend/native değişmedi; EXE veya gereksiz frontend/native build yapılmadı.
