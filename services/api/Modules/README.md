# API modül kapsamı

ASP.NET Core 10 modüler monolit. Identity Supabase JWT/JWKS doğrulamasını sağlar. Tasks doğrulanmış hesaba göre okuma ve create/rename/complete/delete işlemlerini sunar; PostgreSQL reader ve writer ayrı sınırlı roller kullanır. Operation ID ile tekrar gönderim ve revision çatışması korunur.

Görev merkezi modeli şu an id/title/completed/revision ve zaman damgalarıdır. Proje/tarih/öncelik henüz merkezi modelde değildir. `/api/v1/sync/changes` görevlerin değişmez snapshot ve tombstone akışını hesap/epoch cursor’ıyla okur; mevcut reader rolünü kullanır. Merkezi hedef/takvim/finans/bütçe ve masaüstüne delta uygulama henüz yok. [Sözleşme](../../../docs/change-feed.md).

Yerel SQLite kuralları tek başına sunucu güvenliği değildir. Yeni modüllerde alan doğrulaması, sahiplik ve transaction kuralları ASP.NET Core/PostgreSQL tarafında da uygulanacak.

Güncel çalışma: [Paket 1](../../../docs/package-1.md). Önceki ADR ve doğrulama dosyaları tarihsel aşamaları anlatır.

Workspace: not/proje create/update/delete operasyonları, kesin revision ve kalıcı işlem makbuzu; ortak değişiklik akışı üzerinden okuma. Masaüstü entegrasyonu henüz yok. [Sözleşme](../../../docs/central-workspace.md).
