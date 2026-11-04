# M0.3 — Taşıma ve hesap/oturum temeli

Tarih: **4 Kasım 2026**, Europe/Istanbul · Sürüm: **0.3.0**

## Projenin taşınması

Yeni ana konum: `C:\Users\Osman\Desktop\Projects\personal-os`

Kaynaklar, `.git`, mevcut bağımlılıklar, önceki derleme dosyaları ve test dosyaları köke; sürüm EXE/ZIP'leri `outputs/` altına; yerel Rust, .NET önbelleği ve geçici araçlar `work/` altına taşındı. Eski sohbet çalışma klasörü boş olduğu doğrulandı. M0.2 EXE ve ZIP dosyalarının SHA-256 değerleri önceki teslimle aynı kaldı. Rust yardımcısı ve README yeni yollara güncellendi. `work/` ve `outputs/` Git dışında tutuldu.

Eski konumu gösteren npm workspace junction'ı kaldırıldı. Yeni junction oluşturma, mevcut oturumun izin denetimince reddedildi. Hiçbir kaynak dosya bu nedenle kaybolmadı. Bu projede `@personal-os/desktop` paket adıyla kaynak import'u yapılmadığından npm workspace komutları gerçek `apps/desktop` klasöründen çalışıyor; yeni konumda build/test komutları başarılı. İzinli normal yerel kurulumda `npm ci` bağlantıyı yeniden oluşturur; uygulama kaynaklarına alternatif paket kopyası konulmadı.

## Gerçek sonuçlar

| Kontrol | Sonuç |
| --- | --- |
| React/TypeScript/Vite üretim derlemesi | Başarılı |
| Vitest | **18/18** geçti: 5 health + 6 storage bridge + 7 identity client |
| Rust gerçek SQLite testleri | **12/12** yeni konumdan geçti; ayrı süreçte yeniden açılış dahil |
| .NET çözüm Release derlemesi | Başarılı, **0 uyarı / 0 hata**; `-m:1` ile |
| Hesap/oturum sunucu kontrolleri | **9/9** geçti; gerçek endpoint delegate'leri süreç içinde, ağ kullanılmadan |
| Windows x64 `.exe` | v0.3.0 başarıyla üretildi |
| Native/HTTP test betiği sözdizimi | `node --check` başarılı |
| Gerçek HTTP smoke testi | API dinlemeye başladı, fakat oturumun yerel bağlantı kısıtı nedeniyle istemci erişemedi; **başarısız/engelli**, başarılı sayılmadı |
| İzinli HTTP + native tekrar | Oturumun `sandbox_approval: false` politikası tarafından otomatik reddedildi |
| WebView2/Playwright ekran kontrolleri | Güncellendi, **bu dilimde çalıştırılmadı** |

İlk TypeScript derlemesinde durum türünün ayrıştırılması hatası bulundu; union türleri ayrılarak düzeltildi ve sonraki üretim derlemesi geçti. İlk paralel .NET çözüm derlemesi hata ayrıntısı vermeden başarısız oldu; tek işçiyle (`-m:1`) tekrarında API ve test projesi başarılı derlendi. Bu iki ilk deneme başarılıymış gibi kaydedilmedi.

## Uygulanan davranış

- `Identity` modülü ve yapılandırma doğrulaması. Varsayılan `Disabled`.
- `GET /api/v1/auth/status` gerçek yerel API durumu verir; girişin aktif olmadığını açıkça belirtir.
- `GET /api/v1/auth/session` doğrulanmamış isteklerde 401/signedOut/null-user döner. Bu dilimde geçerli oturum üretme yolu bulunmaz.
- Hesap kartı API'den durumu okur; bağlantı hatası, yeniden deneme ve girişin henüz etkin olmaması ayrı gösterilir.
- Token, cookie, secret veya kullanıcı kaydı oluşturulmaz. Supabase adaptörü açıkça bağlantısızdır; Supabase'e ağ isteği yapılmaz.

## Dosyalar

`services/api/Modules/Identity/`, `tests/api/`, `apps/desktop/src/identity/`, güncellenen `Program.cs`, `App.tsx`, çözüm/sürüm/kilit dosyaları, test betikleri ve `docs/adr/0003-identity-foundation.md`.

## Açık kalanlar ve durma noktası

Native pencere/IPC akışı ve ağ üzerinden HTTP kontrolü bu sürüm için doğrulanmış değildir. M0.1'deki geçmiş sonuçlar yeni sürüme taşınmadı. Gerçek Supabase bağlantısı, JWT doğrulama, güvenli token saklama, PostgreSQL, görev akışı ve sync henüz uygulanmadı. Yeni servis hesabı, ücretli kaynak veya deploy yoktur.

M0.3 burada durur. Sonraki küçük adım kullanıcı “devam edelim” dediğinde, açık kalan uçtan uca kontrol ve gerçek kimlik sağlayıcısı entegrasyonunun ilk dilimidir.
