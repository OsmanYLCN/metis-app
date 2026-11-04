# M0.1 — Doğrulama ve teslim kaydı

Tarih: **4 Kasım 2026**, Europe/Istanbul. Bu kayıt yalnızca Foundation'ın ilk dilimini kapsar.

## Gerçekte çalıştırılan kontroller

| Kontrol | Sonuç |
| --- | --- |
| TypeScript + Vite üretim derlemesi | Başarılı; Vite 8.3.5 |
| ASP.NET Core 10 Release derlemesi | Başarılı; 0 uyarı, 0 hata |
| Health istemcisi | 5/5 test geçti: sözleşme, HTTP hata, yanlış servis yanıtı, ağ hatası, iptal |
| Gerçek API smoke testi | 4 alt kontrol + test grubu geçti: JSON/no-store, izinli origin'ler, yabancı origin, endpoint/metot sınırı |
| Microsoft Edge arayüz testleri | 4/4 geçti: gerçek API, kesinti/yeniden deneme, gezinme/tema/odak, dar pencere |
| Tauri Windows x64 Release derlemesi | Başarılı; `personal-os-desktop.exe` üretildi |
| Windows Release çalışma testi | Başarılı; gerçek WebView2 açıldı, CSP/CORS üzerinden API'ye bağlandı, Görevler boş ekranına ve geri gezindi |
| npm kurulum güvenlik taraması | Son kurulumda 0 açık bildirildi; Rust güvenlik taraması yapılmadı |
| Görsel inceleme | Açık/koyu arayüz ekran görüntüleri incelendi; native WebView2 görüntüsü de alındı |

Ortam: Windows x64, Node.js 24.16.0, npm 11.13.0, .NET SDK 10.0.401, Rust 1.99.1 MSVC, Tauri 2.12.5. Paketlerin kesin sürümleri `package-lock.json` ve `Cargo.lock` içindedir.

İlk ağ/yerel bağlantı denemeleri çalışma ortamının erişim kısıtlamasına takıldı; izinli tekrarlarla doğrulandı. İlk native denemede eksik Windows simgesi derleme hatası verdi; kaynak SVG ve türetilmiş ICO/PNG eklenerek düzeltildi. Bunlar tamamlanmamış test olarak bırakılmadı.

## Teslim edilen ana dosyalar

- `apps/desktop/src/App.tsx`, `styles.css`, `tokens.css`: uygulama kabuğu ve tasarım temeli.
- `apps/desktop/src/api/health.ts`: gerçek yerel health bağlantısı.
- `apps/desktop/src-tauri/`: Rust pencere host'u, Tauri yapılandırması, simgeler ve kilit dosyası.
- `services/api/Program.cs`: health endpoint ve yerel CORS sınırı.
- `PersonalOS.slnx`, `global.json`, npm workspace/kilit dosyaları: repo ve build temeli.
- `scripts/`, `tests/ui/`: tekrarlanabilir doğrulamalar.
- `README.md`, `docs/adr/0001-foundation.md`: çalıştırma rehberi ve karar kaydı.
- `docs/screenshots/`: arayüz kanıtları.

## Tamamlanmayan kapsam

Hesap/oturum doğrulama, SQLite, merkezi PostgreSQL, sync/outbox, görev CRUD'ı ve bütün gerçek iş modülleri **bilerek uygulanmadı**. Modern Dashboard görünümü bu aşamada temel durum önizlemesidir; gerçek üretkenlik/finans verisi içermez. Web/Android ürünü, installer, kod imzalama, otomatik güncelleme ve deploy yoktur.

Health yalnızca API sürecini gösterir. Gerçek API yereldir; bulut bağlantısı yoktur. Uygulama bulut hesabı açmadı, ücretli servis başlatmadı, gizli anahtar veya kişisel finans bilgisi eklemedi. Native API ayrı geliştirme süreci olarak başlatılır. Testlerin sonunda test süreçleri kapatıldı.

## Sonraki küçük adım

**Önerilen M0.2: yerel SQLite adaptörü + ilk migration + açma/yeniden açma testleri.** Auth, sync ve görev iş akışı bu dilime dahil edilmeyecek. Kullanıcı “devam edelim” demeden bu adım başlatılmayacak.
