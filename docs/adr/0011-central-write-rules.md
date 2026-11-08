# ADR-0011 — Merkezi oluşturma ve başlık düzenleme kuralları

Durum: karar katmanı M0.13'te, PostgreSQL writer ve işlem günlüğü M0.14'te, HTTP uçları M0.15'te ve kontrollü canlı doğrulama M0.16'da uygulandı.

## Kapsam

İlk yazma sözleşmesi yalnızca Create ve Rename içerir. İstemci işlem UUID'si, görev UUID'si, tür, beklenen revision ve başlık gönderir. Kullanıcı kimliği komutta yoktur; gelecekte endpoint tarafından doğrulanan hesaptan alınacaktır. Başlık kırpılır, 1–200 Unicode kod noktası olmalıdır; kontrol karakterleri ve bozuk UTF-16 reddedilir. Ham girdi sınırı 400 UTF-16 birimidir. Oluşturmada beklenen revision 0; düzenlemede pozitif ve mevcut kayda tam eşit olmalıdır. Sunucu tarihleri/revision istemciden alınmaz.

## Tekrar gönderme

`(account_id, operation_id)` gelecekteki işlem günlüğünün benzersiz anahtarıdır. Sürüm 1 kanonik JSON'un SHA-256 özeti hesap, işlem/görev kimlikleri, tür, beklenen revision ve kırpılmış başlığı kapsar. Aynı işlem ve aynı içerik, ilk başarılı işlemin revision'ını bildirir; ikinci kez değişiklik üretmez. Aynı işlem kimliği farklı içerikle kullanılırsa OperationConflict döner. Yanıtı kaybolan işlem tekrarında operation_id korunur; kullanıcı çatışmayı çözüp yeni bir düzenleme yaparsa yeni operation_id gerekir.

Receipt yalnızca sunucunun başarılı ve commit edilmiş işlem kaydıdır, istemciden kabul edilmez. İlk revision'ın tekrar bildirilmesi güncel görevin o revision'da olduğu anlamına gelmez. Sonradan düzenlenen veya silinen görev, eski başarılı isteğin tekrarından etkilenmez. Başarısız kararlar için bu dilimde receipt üretilmez; saklama/temizleme süresi henüz belirlenmedi. Retry güvencesi receipt tutulduğu sürece geçerlidir; writer diliminde erken silmeye izin verilmeyecek.

## Çatışma ve sahiplik

Mevcut veya silinmiş görev ID'siyle yeni Create kabul edilmez. Rename, farklı revision için Conflict; kayıp/silinmiş görev için aynı NotFound sonucunu döndürür. Başka hesaba veya göreve ait kayıt/receipt döndüren bir adaptör Unavailable ile reddedilir. En büyük revision değeri artırılmaya çalışılmaz. Hiçbir hata başka hesabın görev içeriğini döndürmez.

`TaskWriteRules.Decide` saf karar fonksiyonudur; veri değiştirmez, kilit veya transaction yerine geçmez. Gelecekteki writer hesap kapsamını, operation ID için eşzamanlılık kontrolünü, görev kilidi/revision koşulunu ve görev + receipt kaydını **tek atomik veritabanı işlemi** içinde sağlamalıdır. Saf fonksiyon testleri eşzamanlı PostgreSQL yazma garantisi olarak sunulamaz.

## M0.14 uygulaması

Migration 0003 ayrı `metis_writer` login rolü, FORCE RLS korumalı işlem günlüğü ve `apply_task_write` fonksiyonunu ekler. Rol tablo sahibi, rol üyesi, süper kullanıcı veya BYPASSRLS değildir. Görevlerde yalnızca SELECT, yeni kaydın `user_id/id/title` sütunlarına INSERT ve `title` sütununa UPDATE alır. Tamamlama, silme, sahiplik, revision ve tarih sütunlarına yazamaz. Günlük yalnızca kendi hesabında okunup eklenebilir; güncellenemez veya silinemez.

Aynı hesap/operation çifti transaction-scope advisory lock ile sıralanır. Fonksiyon journal kontrolü, revision koşullu görev yazması ve receipt eklemesini tek transaction içinde yapar. Uygulama adaptörü başlamadan rol, izin, RLS, migration ve Project Ref bağını denetler; doğrulanmış hesap claim'lerini transaction-local olarak ayarlar. Parametreli SQL, süre/lock sınırları ve bağlantı havuzu bağlam temizliği korunur.

M0.14 entegrasyon testi Npgsql üzerinden TCP ile izole PostgreSQL motoruna bağlanır; create, aynı isteğin replay'i, değiştirilmiş operation, rename, eski revision, hesap RLS, iptal ve DELETE reddini doğrular. Son durumda tek görev revision 2 ve yalnızca iki başarılı receipt bulunur. PGlite socket tek backend kullandığından gerçek paralel Supabase oturum yükünü kanıtlamaz; advisory lock ve benzersiz anahtar gerçek PostgreSQL semantiğine göre tasarlanmıştır.

## M0.15 HTTP sınırı ve henüz etkin olmayanlar

Ayrı writer yapılandırması, DI kaydı ve create/rename HTTP uçları eklendi. Varsayılan writer Disabled olduğundan canlı migration/parola/yerel secret tamamlanmadan 503 döner. İstek kullanıcı ID'si kabul etmez; hesap yalnızca doğrulanmış token'dan gelir. JSON 4 KiB ile sınırlı, bilinmeyen alanlar reddedilir. Başarı yanıtı task ID ve revision içerir; görev içeriğini veya kullanıcı ID'sini geri sızdırmaz.

Masaüstü yükleme, otomatik sync, silme/tamamlama yazmaları eklenmedi. `metis_reader` salt okunur kalır ve `syncAvailable=false` korunur. Migration 0003 canlı Supabase'e uygulanmadı, writer parolası oluşturulmadı ve masaüstü istemcisi HTTP yazma uçlarını çağırmaz.

## M0.16 canlı etkinleştirme

Migration 0003, ayrı `metis_writer` parolası ve repo dışındaki yerel writer ayarı canlı projede etkinleştirildi. Supabase'in korumalı `auth` şemasına özel rol erişimi kalıcı olmadığından migration 0004, policy ve writer fonksiyonunu transaction-local `request.jwt.claims` değerine taşıdı; writer rolünden `auth` şema/fonksiyon izinlerini kaldırdı. Adaptör başlangıç koruması migration 4'ü ve `auth` şema izolasyonunu zorunlu tutar.

Masaüstü v0.13.0 yalnızca kullanıcının açıkça başlattığı bağlantı kontrolünde tek sentetik görev oluşturur, aynı isteği replay eder, başlığı revision 2'ye düzenler ve kaydı yeniden okur. Bu akış canlı hesapta tamamlandı. Normal yerel görev oluşturma/düzenleme hâlâ SQLite'tadır; otomatik yükleme, silme/tamamlama yazmaları ve sync kapalıdır.
