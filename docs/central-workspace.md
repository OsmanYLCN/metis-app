# Merkezi proje ve notlar — Paket 1

## Kurulum

0006’nın uygulanmış olması gerekir. Supabase → SQL Editor → New query aç. `services/api/Database/Migrations/0007_workspace.sql` dosyasının tamamını yapıştırıp bir kez Run de. İçinde değiştirilecek değer, parola veya proje referansı yok. Başarılı olunca yerel API’yi yeniden başlat: API terminalinde Ctrl+C, sonra `npm.cmd run dev:api`.

Eski SQL’leri tekrar çalıştırma. Bu migration yerel kayıtları yüklemez, mevcut görevleri değiştirmez. Mevcut reader/writer hesaplarını kullanır; yeni anahtar veya hesap gerekmez. Canlı Supabase bu geliştirme sırasında değiştirilmedi. 0007 olmadan mevcut görev API’si çalışır, yeni proje/not yazması 503 verir.

## Sözleşme

`POST /api/v1/workspace/{kind}/{id}/operations`

`kind`: `note` veya `project`. `id` ve `operationId`: sıfır olmayan, tiresiz UUID. Bearer oturumu zorunlu, hesap yalnızca token’dan gelir.

```json
{
  "operationId": "cccccccccccc4ccc8ccccccccccccccc",
  "action": "create",
  "expectedRevision": 0,
  "payload": { "title": "Örnek", "body": "İçerik", "state": "active", "pinned": false }
}
```

- Create: expectedRevision 0; aynı ID mevcut veya silinmişse conflict.
- Update: dört alanın tamamı ve son merkezi revision gerekir. Başka sürümün üzerine sessiz yazma yok.
- Delete: payload `{}`, son merkezi revision gerekir. Fiziksel silme yerine tombstone.
- Başlık 1–200 Unicode karakter, kırpılmış ve kontrol karakteri içermez. İçerik en çok 20.000 Unicode karakter; satır sonu ve tab kabul edilir.
- Not state yalnızca active; pinned desteklenir. Proje active/paused/done, pinned false.
- Gövde gerçek okunan byte sayısıyla 128 KiB sınırında; bilinmeyen alanlar reddedilir.
- 200: operationId/id/kind/revision/replay. 400 invalid_workspace_write, 404 workspace_not_found, 409 workspace_conflict veya workspace_operation_conflict, 503 workspace_store_unavailable.
- Aynı operation ID ve aynı istek, eski başarılı sonucu döndürür; aynı ID farklı istekle kullanılamaz. Görevlerin operation ID alanı ayrı; workspace günlüğü not/proje arasında ortaktır.

Okuma ortak `/api/v1/sync/changes` üzerinden yapılır. Entity artık task, note veya project olabilir; proje/not snapshot’ı id/kind/title/body/state/pinned/revision/createdAt/updatedAt/deletedAt içerir. Ayrı liste/detail API’si bu dilimde yok. Merkezi revision ile yerel revision eşit varsayılmamalı; istemci entegrasyonu bunları ayrı takip etmeli.

## Güvenlik ve atomiklik

Reader yalnızca SELECT, hesap kapsamlı RLS. Writer tabloya doğrudan INSERT/UPDATE/DELETE yapamaz; yalnızca kısıtlı işlem fonksiyonunu çağırır. SECURITY DEFINER fonksiyonu sabit search_path, gerçek session_user, transaction-local claims, alan doğrulama ve açık user_id koşullarıyla çalışır. API ayrıca giriş rolünü, üyeliklerini, RLS, kurulum eşleşmesini ve doğrudan tablo yazma yetkisinin yokluğunu kontrol eder. Uygulama owner/superuser bağlantısını kabul etmez.

Hesap bazlı işlem kilidi, kayıt değişimi, kalıcı işlem makbuzu ve ortak değişiklik günlüğü tek transaction içindedir. Başarısız işlem makbuz bırakmaz. Merkezi silme, ileride yerel istemciye uygulanabilmesi için korunur. Otomatik fiziksel veri temizliği/retention yoktur; günlük ve işlem makbuzları geçmiş not içeriği barındırabilir.

## Bu bölümün sınırı

Masaüstü henüz bu endpoint’e bağlanmadı; yerel SQLite değişmedi. Projelerin görevlere merkezi ilişkisi, planlama alanları, yerel outbox, ilk kayıt uzlaştırması, delta indirme ve çatışma ekranı sırada. Otomatik toplu yükleme yok. Hedef/takvim/finans/bütçe merkezi modelleri de sonraki bölümde. Paket 1 tamamlanmış değildir.

## Doğrulama

`npm.cmd run test:workspace`: Release build; yerel PGlite + gerçek Npgsql + JWT doğrulayan HTTP test hattı. Not/proje yaşam döngüsü, tekrar, farklı payload ile aynı işlem ID’si, eski revision, başka hesap, kind değiştirme, silinen ID’yi yeniden kullanma reddi, alan sınırları, tablolara doğrudan erişim reddi, ortak sıra, değişmez snapshot ve tam makbuz sayıları doğrulandı. 58 kontrol grubu geçti (mevcut kimlik/görev kontrolleri dahil). Test verisi sentetiktir; canlı hesap ve EXE kullanılmadı. Gerçek PostgreSQL üzerinde eşzamanlı iki cihaz testi Paket 1 bitiş işidir.
