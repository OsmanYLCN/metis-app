# Merkezi veritabanı

Mevcut görev şeması ve reader/writer/lifecycle izinleri Migrations/0001–0005 dosyalarındadır. Kullanıcı önceki çalışmalarda Supabase kurulumunu ve canlı görev bağlantısını doğruladı; bu paket başlangıcında canlı sistem yeniden sorgulanmadı.

Bu SQL dosyaları uygulama açılışında otomatik çalışmaz. Mevcut kurulumda tekrar çalıştırılmaları istenmiyor. Yerel SQLite şema 13 migration’ı ayrı süreçtir ve yeni Supabase SQL gerektirmez.

Çok modüllü merkezi veri ve delta sync değişiklikleri henüz uygulanmadı. [Paket 1](../../../docs/package-1.md) bunları izler.

Kurulum referansları: [reader](../../../docs/central-postgres-setup.md), [writer](../../../docs/central-writer-setup.md). Sunucu parolası/service-role anahtarı masaüstüne veya VITE_* değişkenlerine konmaz.
