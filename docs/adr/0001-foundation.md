# ADR-0001 — Geniş ürün kapsamı, küçük uygulama dilimleri

Tarih: 2026-11-04 · Durum: Kullanıcının mimari kararı uygulanıyor · Dilim: M0.1

## Bağlam

Personal OS; Dashboard, Calendar, Tasks, Projects, Finance, Notes, Goals, Files, Notifications, Automations, Analytics ve Assistant modüllerini içerecek. Düşük operasyonel maliyet ve genişletilebilirlik temel kısıtlardır. Bu liste ilk dilimde bütün modüllerin uygulanması anlamına gelmez.

## Karar

- İlk istemci Windows Tauri 2 + React + TypeScript + Vite. Android daha sonra React Native + Expo; web daha sonra. Tauri mobile'a geçiş kararı alınmadı.
- Backend ASP.NET Core 10/C#, tek dağıtımlı modüler monolit. İş kuralları React veya Rust host'a taşınmaz. Başlangıçta mikroservis, Redis, Kafka veya Kubernetes yok.
- Merkezi PostgreSQL; Supabase Free ilk aday. Yerel SQLite ileriki dilimde açılacak. Şu anda DB sürücüsü, migration veya veri kaydı yok.
- Dosyalar için Cloudflare R2 adayı. Hosting için GitHub Student Developer Pack Heroku kredisi adayı. Kotalar, kredi uygunluğu ve fiyatlar deploy öncesi doğrulanacak. Bu dilimde hesap açılmaz, deploy yapılmaz, ücretli hizmet başlatılmaz. Sıfır maliyet garanti edilmez.
- Hesap için Supabase Auth planı sonraki onaylı dilimde değerlendirilecek; backend yetki kontrolleri zorunlu olacak. UI şu anda oturum açılmış gibi davranmaz.
- Gelecek senkronizasyon yönü: yerel outbox + delta sync + optimistic concurrency. SignalR yalnızca değişiklik bildirimi; kalıcı veri kaynağı değil. Finans/not çatışmaları sessiz veri ezme ile çözülmez. Bu protokol bu dilimde uygulanmadı.
- Monorepo kökünde npm workspace, `apps/desktop` ve `services/api`. Ortak paket, soyut repository veya boş platform projeleri gerçek ihtiyaç doğmadan eklenmez.
- UI tasarım token'ları saf CSS'de tutuldu. Önceki planda önerilen Tailwind/bileşen araçları, geniş form ve tablo ihtiyaçları geldiğinde değerlendirilecek. Şimdilik CSS bağımlılığı gerekmiyor.

## Şu anda gerçek akış

```text
Tauri Windows WebView2 (veya yerel Vite önizlemesi)
    React shell → fetch GET http://127.0.0.1:5080/health
                     → ASP.NET Core process health

Gelecek: SQLite ↔ sync API ↔ PostgreSQL; yetkili dosya akışı ↔ R2
```

Health yalnızca sürecin çalıştığını kanıtlar. Hesap doğrulama, veritabanı hazırlığı, çevrimdışı çalışma, sync veya iş akışı hazır demek değildir. UI bekleme, bağlı ve erişilemiyor durumlarını ayırır; mock başarıya düşmez. Harici bağlantılar yoktur.

## Sonuçlar ve sınırlar

API istemciden bağımsız olduğundan Android/web ileride aynı sözleşmeleri kullanabilir. Tek API süreci maliyeti azaltır; modül sınırları baştan belgelenir. Rust host minimum yetkili pencere kabuğudur. Yerel geliştirmede API ayrı süreçte çalışır; kullanıcıya dağıtılacak backend adresi ve auth henüz belirlenmemiştir. Native executable geliştirme doğrulamasıdır; imzalı son kullanıcı dağıtımı değildir.

Ertelenenler: auth/hesap doğrulama, SQLite ve PostgreSQL migration'ları, sync/outbox, görev akışı, veri yedekleme/geri yükleme, gerçek Dashboard widget'ları, sürükle-bırak, komut paleti, arama, global quick add, form/modal/tablo altyapısı, bildirimler, Assistant işlemleri, hosting ve installer.

M0.1 sonunda durulur. Önerilen M0.2 yalnızca yerel SQLite adaptörü ve ilk migration'dır. Auth, sync ve ilk görev akışı ayrı onaylı dilimlerdir; sonraki dilim otomatik başlatılmaz.
