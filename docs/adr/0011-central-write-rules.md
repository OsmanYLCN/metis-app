# ADR-0011 — Merkezi oluşturma ve başlık düzenleme kuralları

Durum: karar katmanı uygulandı (M0.13). Kalıcı writer, işlem günlüğü ve HTTP yazma uçları sonraki dilimde.

## Kapsam

İlk yazma sözleşmesi yalnızca Create ve Rename içerir. İstemci işlem UUID'si, görev UUID'si, tür, beklenen revision ve başlık gönderir. Kullanıcı kimliği komutta yoktur; gelecekte endpoint tarafından doğrulanan hesaptan alınacaktır. Başlık kırpılır, 1–200 Unicode kod noktası olmalıdır; kontrol karakterleri ve bozuk UTF-16 reddedilir. Ham girdi sınırı 400 UTF-16 birimidir. Oluşturmada beklenen revision 0; düzenlemede pozitif ve mevcut kayda tam eşit olmalıdır. Sunucu tarihleri/revision istemciden alınmaz.

## Tekrar gönderme

`(account_id, operation_id)` gelecekteki işlem günlüğünün benzersiz anahtarıdır. Sürüm 1 kanonik JSON'un SHA-256 özeti hesap, işlem/görev kimlikleri, tür, beklenen revision ve kırpılmış başlığı kapsar. Aynı işlem ve aynı içerik, ilk başarılı işlemin revision'ını bildirir; ikinci kez değişiklik üretmez. Aynı işlem kimliği farklı içerikle kullanılırsa OperationConflict döner. Yanıtı kaybolan işlem tekrarında operation_id korunur; kullanıcı çatışmayı çözüp yeni bir düzenleme yaparsa yeni operation_id gerekir.

Receipt yalnızca sunucunun başarılı ve commit edilmiş işlem kaydıdır, istemciden kabul edilmez. İlk revision'ın tekrar bildirilmesi güncel görevin o revision'da olduğu anlamına gelmez. Sonradan düzenlenen veya silinen görev, eski başarılı isteğin tekrarından etkilenmez. Başarısız kararlar için bu dilimde receipt üretilmez; saklama/temizleme süresi henüz belirlenmedi. Retry güvencesi receipt tutulduğu sürece geçerlidir; writer diliminde erken silmeye izin verilmeyecek.

## Çatışma ve sahiplik

Mevcut veya silinmiş görev ID'siyle yeni Create kabul edilmez. Rename, farklı revision için Conflict; kayıp/silinmiş görev için aynı NotFound sonucunu döndürür. Başka hesaba veya göreve ait kayıt/receipt döndüren bir adaptör Unavailable ile reddedilir. En büyük revision değeri artırılmaya çalışılmaz. Hiçbir hata başka hesabın görev içeriğini döndürmez.

`TaskWriteRules.Decide` saf karar fonksiyonudur; veri değiştirmez, kilit veya transaction yerine geçmez. Gelecekteki writer hesap kapsamını, operation ID için eşzamanlılık kontrolünü, görev kilidi/revision koşulunu ve görev + receipt kaydını **tek atomik veritabanı işlemi** içinde sağlamalıdır. Saf fonksiyon testleri eşzamanlı PostgreSQL yazma garantisi olarak sunulamaz.

## Henüz etkin olmayanlar

Yeni DB rolü, migration, yazma izni, POST/PATCH endpoint, masaüstü yükleme, otomatik sync, silme/tamamlama yazmaları eklenmedi. `metis_reader` salt okunur kalır. `syncAvailable=false` korunur. Bir sonraki küçük dilim: ayrı ve sınırlı writer rolü, atomik operation journal ve bu iki işlemin izole PostgreSQL entegrasyon testleri; canlı migration ayrıca somut kurulum adımıyla uygulanacak.
