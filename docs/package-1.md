# Paket 1 — Merkezi veri, eşitleme ve veri koruma

Durum: devam ediyor. Kullanıcı paketi onayladı. Bu belge bir sonraki oturumun başlangıç noktasıdır; Paket 2’ye geçilmez.

## Tamamlanan ilk bölüm — v0.49.0

- Hesap kapsamlı yerel snapshot: görevler ve planlama, not/proje, hedef, finans, etkinlik, bütçe, bildirim tercihleri ve görev gönderim günlüğü.
- DPAPI ile aynı Windows profiline bağlı şifreli dosya. Kimlik bilgileri yedeğin dışında.
- Kayıt sayılarıyla önizleme, current/backup digest doğrulaması, mevcut durumun otomatik güvenlik yedeği.
- Tek transaction içinde restore, başka hesaplara dokunmama, başarısızlıkta rollback.
- Sonucu belirsiz, başlamış bulut işlemi varken restore reddi.
- Restore sonrasında kalıcı recovery_guard; native gönderim hazırlığı/ack yollarında kontrol.
- Veri ve eşitleme ekranı, bekleyen/çatışan/sonucu belirsiz görev işlemleri ve elle gönderim.
- Güncel README; eski README arşivlendi. Şema sürümüne sabitlenmiş eski kontroller düzeltildi.

## Devam sırası — kalan işler

1. Merkezi ortak değişiklik akışı ve sürüm sözleşmesi: hesap kapsamlı commit sıralaması, değişmez işlem kimliği, tombstone, batch sınırları ve cursor doğrulaması. Mevcut Tasks API ve writer aynı kaynak üzerinde korunmalı; ikinci bağımsız görev kaynağı yaratılmamalı.
2. Proje/not/hedef/takvim/finans/bütçe merkezi modelleri, alan doğrulamaları, PostgreSQL migration ve en az yetkili API erişimi. Proje ilişkileri önce; görev planlama alanları bundan sonra.
3. Bu modüllerin yerel değişikliklerinin atomik outbox’a alınması. Yeni sürüme geçerken mevcut kayıtları kullanıcı/cihaz sahipliğiyle uzlaştırma; kör toplu yükleme yok.
4. Delta indirme + yükleme, kayıt/cihaz cursor’ları ve kesinti sonrası devam. Sunucudan gelen değişiklik tekrar yerel gönderim kuyruğuna alınmamalı.
5. Çakışma kaydı ve kullanıcı çözüm ekranı. Özellikle finans/not verileri sessizce ezilmemeli. Silme iki yönde de taşınmalı.
6. Recovery guard yalnızca yerel yedek ve mevcut sunucu durumu karşılaştırılıp çakışmalar çözüldüğünde kaldırılmalı. Şu anda kilidi elle açan komut YOK.
7. Taşınabilir dışa aktarma, disk/profil kaybı ve bozuk SQLite için kurtarma; şu anki DPAPI snapshot bunun yerine geçmez.
8. İki ayrı istemci veri dizininde uçtan uca test: offline değişiklik, yeniden deneme, silme, aynı kaydı iki tarafta değiştirme, tekrar başlatma ve güvenlik.

## Paketin bitiş ölçütü

Tüm hedeflenen modüller iki istemci arasında veri kaybetmeden güncellenir; bağlantı kesilmesi ve tekrarlı işlemler yeni kayıt üretmez; hesaplar birbirinin verisine erişmez; yerel/sunucu çatışması görünürdür; geri yükleme sonrası uzlaştırma çalışır. Kritik durumlar test edilmeden paket tamamlandı denmez.

## Sınırlar ve doğrulama

Henüz buluttan indirme veya çok modüllü eşitleme yazılmadı. Bu değişiklikler yeni Supabase SQL gerektirmez. Canlı kullanıcı verisi üzerinde restore/sync testi yapılmaz; sentetik geçici veriler kullanılır. Dağıtım EXE’si yok.

Mevcut yedek formatı 1, şema 13 ile sınırlı. Sonraki şema artışında eski yedeği sessizce reddetmek yerine açık uyumluluk/migration yolu ele alınmalı. Taşınabilir ihracat gelecekte kullanıcı parolasıyla şifreleme gibi bağımsız anahtar yönetimi gerektirir.

Doğrulama (2026-11-19): TypeScript/Vite build geçti; native depolama + DPAPI 61 test geçti; storage bridge 6 test geçti. Tam native kontrolün nedeni veri değiştiren restore ve şema geçişidir. Testler yalnızca geçici sentetik veri kullandı; canlı hesap verisiyle geri yükleme yapılmadı.
