# Merkezi veritabanı

Mevcut görev şeması ve reader/writer/lifecycle izinleri Migrations/0001–0005 dosyalarındadır. Kullanıcı önceki çalışmalarda Supabase kurulumunu ve canlı görev bağlantısını doğruladı; bu paket başlangıcında canlı sistem yeniden sorgulanmadı.

Bu SQL dosyaları uygulama açılışında otomatik çalışmaz. Mevcut kurulumda tekrar çalıştırılmaları istenmiyor. Yerel SQLite şema 13 migration’ı ayrı süreçtir ve yeni Supabase SQL gerektirmez.

0006 görev değişiklik günlüğü ve hesap başına sıralı sayaç ekler; mevcut görevleri başlangıç snapshot’ı olarak taşır. Yeni akış API’si için bir kez uygulanır: [kurulum](../../../docs/change-feed.md). Çok modüllü merkezi veri ve masaüstüne delta uygulama henüz yok. [Paket 1](../../../docs/package-1.md) bunları izler.

Kurulum referansları: [reader](../../../docs/central-postgres-setup.md), [writer](../../../docs/central-writer-setup.md). Sunucu parolası/service-role anahtarı masaüstüne veya VITE_* değişkenlerine konmaz.

0007 not/proje tabloları, kısıtlı işlem fonksiyonu ve ortak akış bağlantısı ekler. Mevcut görev tablolarını ve yerel kayıtları değiştirmez. [Kurulum](../../../docs/central-workspace.md).

0008 hedef/takvim/finans/bütçe için domain tabloları, SQL payload doğrulaması, bütçe doğal anahtarı, kısıtlı işlem fonksiyonu ve ortak akış bağlantısı ekler. [Kurulum](../../../docs/central-domains.md).
