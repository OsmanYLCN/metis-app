# M0.8 doğrulama — 2026-11-07

Sürüm: 0.8.0. Kapsam: gerçek yerel görev oluşturma, listeleme, tamamlama/yeniden açma; hesap/proje bazında bölümlendirme. Önceki koyu tema, ince kaydırma çubukları ve yazı düzenlemeleri korunur.

## Sonuçlar

- TypeScript + Vite üretim derlemesi başarılı.
- Windows Tauri Release derlemesi başarılı.
- Vitest: 54/54 istemci testi geçti; görev köprüsünde zaman aşımı, bozuk yanıt, tarayıcıda yazma reddi ve hata ayrıntılarının gizlenmesi de kontrol edildi.
- Rust: 29/29 test geçti (gerçek Windows SQLite ve DPAPI). Yeni görev testleri migration 1→2, bozuk migration rollback, Unicode/SQL metninin veri olarak saklanması, hesap/proje ayrımı, geçersiz başlıklar, idempotent oluşturma/tamamlama ve 103 kaydın sayfalanmasını içerir.
- Edge kabuk arayüzü: 6/6 test geçti; gerçek yerel API Disabled sağlayıcıyla ve yerel Supabase ayarlarından bağımsız test edildi.
- Edge giriş/görev arayüzü: 5/5 test geçti. Görev yazıldıktan sonra yanıt kaybı simülasyonu, aynı kimlikle tekrar deneme, tamamlama hatası, yeniden açma, gezinme, hesap değişimi ve gecikmiş önceki hesap yanıtı doğrulandı. 390 px genişlikte taşma yok; koyu görev ekranı görsel olarak incelendi.
- Native smoke: gerçek Windows uygulamasında IPC ile görev oluşturuldu/tamamlandı, süreç kapatılıp açıldı ve aynı görev/tamamlanma durumu geri okundu. Başka proje listesi boş döndü. SQLite kimliği, DPAPI tekrar açılış/silme ve genel dosya erişiminin reddi de geçti.

## Testlerin sınırları

Arayüz testlerinde kimlik sağlayıcısı, API yanıtları ve IPC mock'tur; gerçek hesaba giriş yapılmadı. Native smoke gerçek IPC/SQLite/DPAPI ve yerel API kullanır; sağlayıcı Disabled, görev sahipleri sentetiktir. Testler ayrı geçici veri dizinindedir; kullanıcının veritabanı veya oturum kasası kullanılmadı. API kodu değişmediği için JWT TestServer paketi bu dilimde tekrar çalıştırılmadı.

İlk görev UI test denemesinde, bilerek başarısız olan tamamlama işleminde Playwright `check()` başarı beklediği için test durdu. Bu adım `click()` + “işaretlenmedi” doğrulamasına düzeltildi; son 5 test geçti. Native build ile Vite aynı anda çalışırken Rust çıktı dosyaları için watcher EBUSY uyarısı görüldü; her iki işlem de başarılı tamamlandı.

2026-11-07 önceki canlı kurulum adımında kullanıcı Supabase girişini ve yeniden açılışta oturum geri yüklemeyi başarılı bildirdi. Bu kullanıcı doğrulamasıdır; bu dilimdeki otomatik görev testlerinin canlı hesap kullandığı anlamına gelmez. Önceki tarihli M0.5/M0.7 kayıtları o günkü bağlantısız test durumunu anlatır.

## Kullanım

1. Eski uygulamayı kapat. Aynı oturum kasasını iki uygulama örneği aynı anda kullanamaz.
2. Repo kökünde `npm.cmd run dev:api` ile yerel API'yi çalıştır.
3. `outputs/Metis-M0.8.exe` dosyasını aç; mevcut hesabınla giriş yap veya oturumun geri yüklenmesini bekle.
4. Görevler bölümünde başlık ekle, kutuyla tamamla/yeniden aç. Listeyi yenile veya uygulamayı yeniden açıp aynı hesapla kayıtlarını gör.

Veritabanı şeması ilk açılışta 2'ye yükselir. Eski M0.7 uygulaması bu yeni dosyayla çalışmaz ve dosyayı silmez. Görevler yalnızca bu cihazdadır, şifrelenmez ve bulut yedeği yoktur. Düzenleme/silme ve sync henüz eklenmedi.

Çıktılar: `outputs/Metis-M0.8.exe`, `outputs/Metis-M0.8-source.zip`, `outputs/M0.8-Dogrulama.md`. Kaynak arşivi `.env.local`, veritabanı, oturum dosyası, araçlar ve derleme klasörlerini içermez. EXE yalnızca yerel yapılandırmadaki public Supabase bağlantı değerleriyle derlenir.

Sonraki önerilen küçük dilim: görev başlığını düzenleme ve silme akışı. Yeni kullanıcı onayı gelmeden başlanmaz.
