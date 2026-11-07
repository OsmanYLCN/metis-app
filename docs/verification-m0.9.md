# M0.9 doğrulama — 2026-11-07

Sürüm: 0.9.0. Bu dilim yalnızca mevcut yerel görevin başlığını düzenleme ve onayla silme akışını ekler. Yeni modül, bulut bağlantısı, hosting veya ücretli servis açılmadı.

## Davranış

- Görev satırındaki kalem, mevcut başlığı düzenleme alanına getirir. Kaydet/İptal ve Escape desteklenir. Boş başlık kaydedilemez; 1–200 karakter sınırı hem istemcide hem Rust'ta doğrulanır.
- Çöp kutusu görevi hemen silmez. Görev başlığı ve kalıcı silme açıklaması gösterilir; ilk klavye odağı İptal düğmesindedir. Kullanıcı ayrıca “Görevi kalıcı sil” demelidir.
- Başarılı yanıt alınmadan satır değiştirilmez/silinmez. Düzenleme hatasında taslak, silme hatasında onay alanı korunur. Yanıt kaybından sonra tekrar deneme desteklenir.
- İşlemler proje + kullanıcı + görev kimliğine göre sınırlandırılır. Son okunan başlıkla veritabanındaki başlık farklıysa eski taslak/onayla kayıt değiştirilmez; listeyi yenileme istenir.
- Düzenleme tamamlanma durumunu, görev kimliğini ve oluşturulma zamanını korur. Silme fiziksel yerel silmedir; geri al, çöp kutusu ve bulut silme kaydı henüz yoktur.
- Yeni migration gerekmedi; şema 2 korunur. Mevcut M0.8 görevleri kullanılabilir. Yerel bölümlendirme ve şifrelenmemiş görev verisi sınırları ADR-0008'deki gibidir.

## Sonuçlar

- Vitest: 54/54 istemci testi geçti.
- Rust: 33/33 test geçti. Yeni testler düzenleme sonrası tamamlanma/kimlik/zaman korunumu, idempotent tekrar deneme, eski başlıkla işlem reddi, hesap/proje ayrımı, silmenin kalıcılığı ve geçersiz girdilerin kayıtları korumasını doğrular.
- Edge giriş/görev UI: 6/6 test geçti. Düzenlemeyi Escape ile iptal etme, odağın geri gelmesi, boş başlık reddi, hata sonrası taslağı koruma, silmeden vazgeçme, kayıp silme yanıtını tekrar deneme ve 390 px genişlikte taşma kontrolü başarılı. Masaüstü/dar ekran görüntüleri incelendi.
- TypeScript + Vite üretim derlemesi başarılı.
- Tauri Windows Release derlemesi başarılı.
- Native smoke: gerçek Windows IPC/SQLite üzerinde oluşturma, tamamlama, düzenleme ve silme çalıştı. Uygulama süreci kapatılıp yeniden açıldığında düzenlenen kayıt korundu, silinen kayıt geri gelmedi. DPAPI ve dar kapsamlı komut izinleri kontrolleri de geçti.

İlk native denemesi derleme tamamlanmadan eski EXE'yi açtığından yeni komut için ACL reddi aldı. Derlemenin bitmesi beklendi; güncel EXE ile son native test başarılı tamamlandı.

## Gerçek / mock sınırı

Edge testlerinde hesap ve IPC sentetiktir. Native test gerçek EXE, IPC, SQLite ve DPAPI kullanır; `METIS_NATIVE_MOCK_API=1` ile yalnızca health/kimlik API yanıtları mock yapılmıştır. Böylece kullanıcının 5080 portunda çalışan gerçek API'si kapatılmadan test edildi. İzole veri dizini kullanıldı; gerçek kullanıcı görevleri ve oturum kasası okunmadı/değiştirilmedi. Backend kodu değişmedi; API/JWT ve genel shell paketleri bu dilimde yeniden çalıştırılmadı.

Native testi bu modda tekrarlamak için:

```powershell
$env:METIS_NATIVE_MOCK_API = '1'
npm.cmd run test:native
Remove-Item Env:METIS_NATIVE_MOCK_API
```

## Çıktılar ve kullanım

- `outputs/Metis-M0.9.exe`
- `outputs/Metis-M0.9-source.zip`
- `outputs/M0.9-Dogrulama.md`
- `outputs/metis-m0.9-delete-confirmation.png`
- `outputs/metis-m0.9-tasks-compact.png`

Eski uygulamayı kapatıp M0.9'u aç. Yerel API açık kalmalı; gerekirse repo kökünde `npm.cmd run dev:api` ile başlat. Görevler ekranında kalem veya çöp kutusu düğmesini kullan. Kaynak arşivi `.env.local`, veritabanı, oturum kasası ve yerel araçları içermez. EXE, yerel public Supabase bağlantı ayarlarıyla derlendi.

Sonraki önerilen dilim: merkezi görev veri modeli ve sunucuda hesaba göre erişim kuralları. Gerçek bulut eşitlemesi ayrıca ele alınacak; yeni onay olmadan başlanmaz.
