# M0.13 — Merkezi yazma kararlarının ilk dilimi

2026-11-08. Bu dilim sunucu kodundadır; masaüstü sürümü ve kullanılacak EXE **0.12.0** olarak kalır.

M0.12 kapanışı: kullanıcı canlı uygulamada **Bulut okuması doğrulandı** sonucunu gördüğünü bildirdi ve ekran görüntüsü sağladı. Böylece kullanıcı oturumu → yerel API → Supabase okuma kontrolü kullanıcı tarafından doğrulandı.

## Değişiklikler

- `services/api/Modules/Tasks/TaskWriteRules.cs`: oluşturma/başlık düzenleme komutu, başarılı işlem receipt sözleşmesi ve saf karar fonksiyonu.
- `tests/api/TaskWriteRuleChecks.cs`: 9 yeni kontrol grubu.
- [ADR-0011](adr/0011-central-write-rules.md): tekrar gönderme, revision çatışması, atomik writer gereklilikleri ve kapsam sınırları.
- API smoke, native smoke ve Playwright API başlatıcılarında merkezi sağlayıcı test sürecine özel Disabled olarak sabitlendi. Canlı User Secrets ayarları artık bu testleri yanlışlıkla etkinleştirmez. Kullanıcının ayarları değiştirilmedi.

## Kontroller

- API/JWT/karar paketi **48/48** geçti (39 mevcut + 9 yeni grup).
- Yeni gruplar Unicode sınırı, geçersiz giriş, kayıp yanıt tekrarı, değiştirilmiş işlem içeriği, hesap ayrımı, silinmiş ID'nin yeniden kullanılması, eski/gelecek revision, kayıp/silinmiş kayıt ve revision taşmasını kapsar.
- .NET Release solution: **0 uyarı, 0 hata**.
- Ayrı API süreci smoke: **6/6** geçti. Yazma uçlarının hâlâ açık olmadığı da doğrulandı.
- İlk smoke denemesi Development User Secrets'taki canlı merkezi ayarı devraldığı için başarısızdı; test başlatıcısı düzeltildi ve paket tekrar başarılı çalıştı. Native/Playwright başlatıcılarına aynı yalıtım uygulandı; bu iki paket bu dilimde tekrar çalıştırılmadı.
- UI, Rust ve SQL migration kodu değişmedi; masaüstü yeniden derlenmedi. Gerçek PostgreSQL atomik yazma/eşzamanlılık testi bu dilimde yoktur; yeni testler karar katmanını doğrular.

## Kalanlar

Merkezi yazma ve sync **henüz açık değil**. Veri ve izin değişikliği yapılmadı; canlı görevlere dokunulmadı. Mevcut M0.12 uygulamasını kullanmaya devam edebilirsin; bu dilim için terminal/panel işlemi gerekmiyor.

Sonraki küçük dilim, bu kuralları transaction içinde uygulayacak PostgreSQL writer ve işlem günlüğüdür. Otomatik yükleme ayrıca ele alınacak. Yeni kullanıcı onayı olmadan sonraki dilime geçilmez.

Çıktılar: `outputs/Metis-M0.13-source.zip`, `outputs/M0.13-Dogrulama.md`. Yeni masaüstü EXE üretilmedi.
