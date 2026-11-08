# Merkezi görev writer kurulumu — canlı doğrulandı

Bu kurulum 2026-11-08 tarihinde kullanıcının Supabase projesinde tamamlandı. Migration 0003 ve Supabase'in özel `auth` şemasına ihtiyaç duymayan düzeltme migrationı 0004 uygulandı; ayrı writer parolası repo dışındaki User Secrets alanına kaydedildi. Parola veya bağlantı sırrı bu belgede bulunmaz.

## Canlı kurulum sırası

1. Supabase SQL Editor'de `services/api/Database/Migrations/0003_task_writer.sql` ve ardından `0004_task_writer_claims.sql` dosyasını **birer kez** çalıştır.
2. Ayrı `metis_writer` rolüne güçlü ve yeni bir parola ver:

   ```sql
   ALTER ROLE metis_writer PASSWORD 'YALNIZCA_KENDI_EKRANINDAKI_PAROLA';
   ```

   Bu parola `metis_reader`, Supabase hesabı ve uygulama giriş parolasından farklı olmalı. Sohbete, repoya veya ekran görüntüsüne koyma.
3. Daha önce indirilen Supabase kök sertifikasının yolu ve Connect ekranındaki **Session pooler host** ile proje terminalinde çalıştır:

   ```powershell
   ./scripts/configure-central-task-writer.ps1 `
     -ProjectRef 'PROJE_REF' `
     -DatabaseHost 'CONNECT_EKRANINDAKI_HOST' `
     -RootCertificate "$env:LOCALAPPDATA\Metis\certificates\supabase-prod-ca-2021.crt"
   ```

4. Gizli parola sorulduğunda yalnızca terminale `metis_writer` parolasını gir. Yardımcı değeri komut argümanına veya repoya yazmaz; ayrı `CentralTaskWriter:*` User Secrets alanlarına kaydeder. User Secrets geliştirme içindir ve şifreli kasa değildir.
5. API terminalini Ctrl+C ile kapatıp `npm.cmd run dev:api` ile yeniden başlat.

Migration 0004, `metis_writer` rolünün Supabase'in korumalı `auth` şemasına erişmesini gerektirmez. Doğrulanmış hesap claim'leri yalnızca transaction-local `request.jwt.claims` değerinden okunur; writer başlangıç koruması `auth` şema erişiminin kapalı ve migration 4'ün uygulanmış olmasını zorunlu tutar.

## Kurulumdan sonra beklenen davranış

Writer kapalıyken POST/PATCH istekleri 503 `central_writer_not_configured` döner. Açıldıktan sonra yalnızca geçerli kullanıcı Bearer tokenı ile şu iki işlem kullanılabilir:

- `POST /api/v1/tasks`: yeni merkezi görev; istemci operation ID, task ID ve başlık üretir.
- `PATCH /api/v1/tasks/{taskId}`: operation ID, beklenen revision ve yeni başlıkla düzenleme.

Başka hesap ID'si gönderilemez; kullanıcı doğrulanmış tokenın `sub` alanından alınır. Aynı operation aynı içerikle tekrar gelirse ikinci yazma yapılmaz. Farklı içerikle aynı operation veya eski revision 409 döner. Silme, tamamlama, otomatik yükleme ve sync hâlâ kapalıdır.

Canlı kurulum sonrasında kullanıcı onayıyla tek `Metis bağlantı kontrolü` görevi oluşturuldu. Aynı operation ID replay edildi, ikinci değişiklik oluşmadı; ardından başlık düzenlenip revision 2 ve son kayıt okuması doğrulandı. Otomatik testler canlı projeyi kullanmaz.
