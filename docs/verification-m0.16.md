# M0.16 — Canlı writer etkinleştirme ve kontrollü masaüstü doğrulaması

2026-11-08, masaüstü **v0.13.0**.

## Değişiklikler

- Canlı Supabase projesine migration 0003 uygulandı; ayrı `metis_writer` parolası oluşturulup repo dışındaki `CentralTaskWriter:*` User Secrets alanına kaydedildi.
- Migration 0004, writer policy/fonksiyonlarını korumalı `auth` şeması yerine transaction-local `request.jwt.claims` üzerinden çalıştırır. Writer rolünde `auth` şema erişimi kapalıdır.
- `PostgresTaskWriter` başlangıç koruması migration 4 ve `auth` şema izolasyonunu zorunlu tutar.
- Genel Bakış / Bulut bağlantısı kartına kullanıcı tarafından başlatılan **Bulut yazmasını doğrula** işlemi eklendi. Token store dışına çıkmaz; yerel görevler listelenmez veya yüklenmez.
- Kontrol tek sentetik görev oluşturur, aynı operation ID ile replay'i, revision 1'den 2'ye rename'i ve son GET kaydını doğrular.
- Masaüstü sürümü v0.13.0 / M0 Dilim 16 olarak güncellendi.

## Otomatik doğrulama

- React/TypeScript: **6 test dosyası, 63 test geçti**.
- TypeScript + Vite production build geçti.
- API/JWT/görev sözleşmeleri: **55 kontrol geçti**.
- Npgsql + izole PostgreSQL writer: toplam **56 kontrol geçti**; create, replay, operation/revision conflict, hesap RLS, denied delete ve gerçek HTTP adaptörü doğrulandı.
- .NET Release: **0 uyarı, 0 hata**.
- Gerçek API smoke: **6/6 geçti**.
- Windows Release EXE üretildi: `outputs/Metis-M0.16.exe`.

## Canlı doğrulama

- Reader ve writer bağlantıları VerifyFull TLS ile açıldı; roller ayrıdır.
- Migration 0004 kaydı, proje bağı, FORCE RLS, dar sütun izinleri ve `auth` şema izolasyonu geçti.
- İlk deneme eksik `auth` şema erişiminde fail-closed oldu; tablo etkinliği sıfırdı ve gerçek görev oluşmadı. Daha geniş izin vermek yerine migration 0004 ile bağımlılık kaldırıldı.
- Son kullanıcı denemesinde tek görev oluşturuldu; aynı isteğin replay'i ikinci değişiklik üretmedi; başlık revision 2'ye düzenlendi ve son kayıt tekrar okundu. Uygulama **“Bulut yazması doğrulandı”** sonucunu gösterdi.

## Kapsam sınırı

Normal görev ekranı hâlâ yalnızca yerel SQLite verisini değiştirir. Bu dilim yerel görevleri buluta yüklemez; otomatik sync, tamamla/sil bulut yazmaları, çatışma arayüzü, R2, hosting veya diğer modüller yoktur. Canlı projede yalnızca açıkça onaylanan sentetik bağlantı kontrol görevi bulunur. Gizli parola, token ve gerçek kişisel görev içeriği repoya eklenmedi.

Sonraki küçük dilim otomatik olarak başlamaz. Aday adım, normal görev akışına dokunmadan kalıcı yerel outbox/operation kimliği temelini tasarlayıp doğrulamaktır.
