# Merkezi görev writer kurulumu — henüz uygulanmadı

Bu rehber M0.15 koduyla hazırlanmıştır. Canlı Supabase'e migration 0003 uygulanmadı ve writer bağlantısı etkin değildir. Aşağıdaki adımlar bir sonraki onaylı canlı kurulumda uygulanacak; şu anda mevcut M0.12 uygulaması yerel görevlerle çalışmaya devam eder.

## Canlı kurulum sırası

1. Supabase SQL Editor'de `services/api/Database/Migrations/0003_task_writer.sql` dosyasını **bir kez** çalıştır.
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

## Kurulumdan sonra beklenen davranış

Writer kapalıyken POST/PATCH istekleri 503 `central_writer_not_configured` döner. Açıldıktan sonra yalnızca geçerli kullanıcı Bearer tokenı ile şu iki işlem kullanılabilir:

- `POST /api/v1/tasks`: yeni merkezi görev; istemci operation ID, task ID ve başlık üretir.
- `PATCH /api/v1/tasks/{taskId}`: operation ID, beklenen revision ve yeni başlıkla düzenleme.

Başka hesap ID'si gönderilemez; kullanıcı doğrulanmış tokenın `sub` alanından alınır. Aynı operation aynı içerikle tekrar gelirse ikinci yazma yapılmaz. Farklı içerikle aynı operation veya eski revision 409 döner. Silme, tamamlama, otomatik yükleme ve sync hâlâ kapalıdır.

Canlı kurulum sonrasında gerçek hesaba sentetik isimli tek bir test görevi yazıp tekrar/rename davranışını doğrulamak gerekir. Test kaydı kullanıcının açık onayıyla oluşturulmalı; otomatik testler canlı projeyi kullanmaz.
