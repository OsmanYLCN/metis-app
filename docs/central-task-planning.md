# Merkezi görev planlama — Paket 1

## Kurulum

0007 ve 0008 başarılı olmalı. Supabase → SQL Editor → New query aç; `services/api/Database/Migrations/0009_task_planning.sql` dosyasının tamamını yapıştırıp bir kez Run de. Değiştirilecek değer yok. Sonra yerel API terminalinde Ctrl+C ve `npm.cmd run dev:api`.

Eski SQL dosyalarını tekrar çalıştırma. Yeni hesap, parola veya hosting gerekmez. Bu çalışma canlı Supabase’e migration uygulamadı. Görevler korunur; yeni alanların başlangıcı proje yok, tarih yok, öncelik 0. Yerel kayıtlar otomatik yüklenmez.

## Veri ve API

Görev planı mevcut `metis.tasks` tablosundaki project_id/due_date/priority alanlarıdır; ikinci görev kaynağı yoktur. Aynı user_id/proje ID’sine foreign key bulunur. Kısıtlı planlama fonksiyonu yalnızca aynı hesabın silinmemiş proje kaydına bağlar; not veya başka hesap projesi kabul edilmez. Paused/done projeler silinmiş olmadığı için bağlanabilir.

`POST /api/v1/workspace/taskPlan/{taskId}/operations`

```json
{
 "operationId":"cccccccccccc4ccc8ccccccccccccccc",
 "action":"update",
 "expectedRevision":1,
 "payload":{"projectId":null,"dueDate":"2028-02-29","priority":3}
}
```

Görev/işlem/proje ID’leri tiresiz UUID; projectId null olabilir. Üç payload alanı zorunludur. dueDate null veya gerçek YYYY-MM-DD, priority tam sayı 0–3. Planlama yalnızca update kabul eder; görev oluşturma/silme mevcut görev API’sindedir. Plan kaldırma projectId/dueDate=null ve priority=0 ile yapılabilir. Revision mevcut görevin merkezi revision’ıdır; başlık/tamamlanma/silme ile ortak sürüm kullanılır.

200 makbuz ve replay alanı; 400 geçersiz istek, 404 görev veya proje bulunamadı, 409 eski sürüm/işlem kimliği çatışması, 503 şema/yetki/bağlantı sorunu. Planlama makbuzları ayrı task_plan_operations tablosundadır. Başarılı işlemden sonra proje silinmiş olsa bile aynı eski işlem tekrarında eski makbuz döner; silinen projeye yeniden bağlamaz.

GET `/api/v1/tasks` ve `/{id}` artık projectId/dueDate/priority de döndürür. Okuyucu 0009 öncesi şemada null/null/0 varsayılanlarını destekler; yeni plan yazması 0009 gerektirir. Akıştaki task snapshot’ları da bu alanları içerir. UUID biçimi mevcut feed gibi tireli; görev GET ve yazma sözleşmesinde tiresizdir. İstemci mapper’ı bunları normalize etmeli.

0009 öncesindeki değişmez task snapshot’larında plan alanları yoktur: merkezi planda o anda veri olmadığı için null/null/0 olarak yorumlanır. Migration eski snapshot’ları yeniden yazmaz ve görev revision’larını topluca artırmaz. İlk yerel uzlaştırma sırasında bu merkezi varsayılanlar yerel planı sessizce silmemeli.

## Proje silme

Projenin tombstone işlemi öncesinde bağlı silinmemiş görevlerin project_id alanı kaldırılır. Görev başlığı/tamamlanma/tarih/öncelik korunur. Her görev kendi revision artışı ve task değişiklik kaydı alır; ardından proje tombstone’u günlüğe girer. Hepsi proje işlemiyle aynı transaction’dadır. Tekrar gönderim tekrar bağ kaldırma veya revision artışı yaratmaz. Önceden silinmiş görevlerin tarihsel proje bağı korunur.

Planlama ve proje işlemleri aynı hesap advisory lock’unu kullanır. Bağlı görevler proje capture trigger’ı ortak head kilidini almadan önce sıralı kilitlenir; task→head kilit sırası korunur. Doğrudan writer rolüne yeni plan kolonlarında INSERT/UPDATE yetkisi verilmez. Tablo/claim/rol kuralları API ve SQL fonksiyonunda korunur. Çok büyük proje silmelerinde timeout işlemin tamamını geri alır; mevcut 8 saniyelik API sınırı değiştirilmedi.

## Durum ve doğrulama

Masaüstü planı kalıcı gönderim niyetiyle update edilir; otomatik tarama değişmiş proje/tarih/öncelik alanlarını gönderir. Görev/proje bağımlılığı ve ortak revision zinciri native tarafta korunur. Buluttan gelen plan mevcut karşılaştırma/onay yoluyla uygulanır. [İstemci akışı ve sınırlar](automatic-sync-recovery.md). Bu, otomatik iki yönlü alan birleştirme anlamına gelmez.

Release build sıfır hata/uyarı. `npm.cmd run test:task-planning`: geçici PGlite üzerinde gerçek Npgsql+JWT/HTTP ile görev oluşturma, proje/not ayrımı, hesap sahipliği, tarih/öncelik sınırları, revision ve operation çatışmaları, silme tekrarı, silme sonrası eski makbuz tekrarı, task GET alanları ve feed’de güvenli detach/tombstone sırası doğrulandı. Gerçek çok oturumlu PostgreSQL yarış testi ve iki cihaz testi Paket 1 kabul koşulunda duruyor. Canlı veri, yerel SQLite ve EXE değiştirilmedi.
