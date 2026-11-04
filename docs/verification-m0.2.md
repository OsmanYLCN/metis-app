# M0.2 — Yerel SQLite doğrulama kaydı

Tarih: **4 Kasım 2026**, Europe/Istanbul · Sürüm: **0.2.0**

## Gerçekte çalıştırılan kontroller

| Kontrol | Sonuç |
| --- | --- |
| TypeScript + Vite üretim derlemesi | Başarılı |
| Vitest | 11/11 geçti: önceki 5 health + yeni 6 yerel köprü testi |
| Rust / gerçek Windows SQLite | 12/12 geçti; mock veya bellek içi DB kullanılmadı |
| Windows x64 Release `.exe` | Başarılı; v0.2.0 üretildi |
| Tauri izin manifesti | Build tarafından üretildi; yalnızca `main` → `allow-local-storage-status` doğrulandı |
| Native test betiğinin sözdizimi | `node --check` başarılı |
| M0.2 native pencere / WebView2 uçtan uca testi | **Çalıştırılamadı**: otomatik izin politikası yükseltilmiş çalıştırma talebini reddetti |
| Güncellenen Playwright ekran testleri | **Bu dilimde çalıştırılmadı**; önceki M0.1 sonuçları M0.2 sonucu sayılmadı |
| API | Kod değiştirilmedi; M0.1 başarılı kontrolleri tarihsel kayıtta tutuldu, bu dilimde tekrar çalıştırılmadı |

12 Rust testi: ilk dosya/şema, bağlantı kapatıp yeniden açma, iki ayrı işletim sistemi süreci arasında kalıcılık, aynı anda ilk açılış, başarısız migration rollback'i, daha yeni şemayı koruma, yabancı veritabanını koruma, bozuk dosyanın baytlarını koruma, değiştirilmiş migration özeti, satır sonu normalizasyonu, kilit/zaman aşımı ve yeniden deneme, geçersiz üst klasörü koruma.

Rust testleri gerçek `winsqlite3.dll` ile geçici disk dosyalarını kullanır. Ayrı süreç testi, test çalıştırılabilir dosyasını iki kere başlatır ve aynı depolama kimliğini doğrular; bu **pencere/WebView2 testi değildir**. Test dosyaları sahip oldukları geçici dizinlerden temizlenir. Native GUI test betiği ise izole test DB/profil diziniyle hazırlandı, fakat burada yürütülmedi.

## Ortam ve sınırlamalar

Windows x64; Rust 1.99.1 MSVC; Windows SDK 10.0.26100.0; sistem SQLite DLL dosya sürümü 3.53.4. Mevcut Node/.NET/Tauri araçları M0.1'den korundu. Rust/NPM paketlerinin kilit dosyaları projede bulunur.

Yeni `rusqlite` ve npm Tauri API paketlerini indirme denemesi DNS/ağ erişiminde başarısız oldu. İzinli tekrar talebi oturum politikası (`sandbox_approval: false`) tarafından otomatik reddedildi. Kullanıcının yeni bir tercihi beklenerek iş durdurulmadı; mevcut Windows SQLite SDK bileşeni ve belgelenmiş Tauri global köprüsüyle uygulama tamamlandı. Bu değişiklik ve taşınabilirlik sınırı ADR-0002'de açıklandı.

M0.2 native GUI testini çalıştırma izni de aynı politika tarafından reddedildi. Bu nedenle yeni sürümün pencere içindeki durum kartı/IPC akışının uçtan uca geçtiği iddia edilmez. `npm.cmd run test:native` ve `npm.cmd run test:ui` betikleri izinli yerel ortam için hazırdır. `rustfmt` mevcut minimal araç kurulumunda yoktu; otomatik Rust biçimleme çalıştırılamadı.

## Değişen ana dosyalar

- `apps/desktop/src-tauri/src/storage/`: özel SQLite adaptörü, migration ve veri koruma testleri.
- `apps/desktop/src-tauri/migrations/0001_local_foundation.sql`: yalnızca `schema_migrations` ve `local_metadata` tabloları.
- `apps/desktop/src-tauri/src/main.rs`, `build.rs`, `capabilities/local-storage.json`, `tauri.conf.json`: sınırlı native köprü ve dosya konumu.
- `apps/desktop/src/storage/`: tür denetimli köprü, durum kartı ve istemci testleri.
- `App.tsx`, sürüm/kilit dosyaları, test betikleri ve README güncellendi.
- `docs/adr/0002-local-sqlite.md`: sağlayıcı seçimi, transaction ve güvenlik sınırları.

## Kapsam

Yalnızca temel kayıt ve migration bilgisi saklanır. Auth, kullanıcı hesabı, PostgreSQL, sync, outbox, görev CRUD'ı ve diğer iş modülleri uygulanmadı. Hesap açılmadı, deploy/ücretli servis yapılmadı, gizli anahtar veya gerçek kişisel veri eklenmedi. SQLite bu aşamada şifrelenmez.

Bu dilim sonunda duruldu. Önce kalan native pencere doğrulaması, ardından kullanıcı yeniden “devam edelim” derse M0.3 hesap/oturum temeli önerilir.
