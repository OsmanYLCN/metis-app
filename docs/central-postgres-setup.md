# Merkezi görev okumasını bağlama — M0.11

Kod hazır, canlı Supabase bağlantısı henüz kurulmadı. Mevcut masaüstü görevleri SQLite'ta kalır; bu ayarlar onları yüklemez veya eşitlemez. Ücretli servis gerekmez. İlk doğrulamayı kişisel veri içermeyen bir geliştirme projesinde yap. Ayrı proje kullanırsan masaüstündeki public URL/key ve Auth kullanıcısı da aynı projeye ait olmalı.

## 1. Veritabanını hazırla

Supabase projesinin SQL Editor bölümünde aşağıdaki dosyaların içeriğini sırayla **birer kez** çalıştır:

1. `services/api/Database/Migrations/0001_central_tasks.sql`
2. `services/api/Database/Migrations/0002_task_reader.sql`

Daha önce uygulanmış migration'ı yeniden çalıştırma. Mevcut tablo/rol hatasında DROP veya veri sıfırlama yapma; migration günlüğünü kontrol et. Bu dosyalar otomatik çalıştırılmaz.

Ardından aşağıdaki public değeri kendi Project Ref'inle değiştirerek SQL Editor'de çalıştır. Project Ref, `https://PROJE_REF.supabase.co` adresindeki parçadır:

```sql
INSERT INTO metis.installation(id, project_ref) VALUES (1, 'PROJE_REF');
```

`metis_reader` için ayrı ve güçlü bir parola belirle. PostgreSQL istemcin varsa yönetici bağlantısında `\password metis_reader` gizli giriş kullanır. Alternatif olarak Supabase SQL Editor'de yalnızca kendi ekranında `ALTER ROLE metis_reader PASSWORD 'SECTIGIN_PAROLA';` çalıştır; bu parolayı sohbet, repo veya ekran görüntüsünde paylaşma. SQL Editor sorgu geçmişinde kalabileceğini dikkate al. Tek tırnak içeren SQL parola değerlerinde tırnağı iki kez yazmak gerekir. Uygulama `postgres` veya `service_role` ile bağlanmaz. [Supabase rol rehberi](https://supabase.com/docs/guides/database/postgres/roles).

`metis` şemasını Data API exposed schemas listesine eklemek gerekmez. API doğrudan PostgreSQL sürücüsü kullanır.

## 2. Bilgisayarda ayarı kaydet

Supabase **Connect → Session pooler** bölümünden yalnızca host'u al. Port **5432**, veritabanı **postgres**. Host bölgeden tahmin edilmez. Özel rol için kullanıcı adı `metis_reader.PROJE_REF` olur; yardımcı bunu kendisi oluşturur. Session pooler IPv4 bağlantısını destekler. [Supabase bağlantı rehberi](https://supabase.com/docs/guides/database/connecting-to-postgres).

Proje kökündeki PowerShell terminalinde, örnekleri gerçek public değerlerle değiştir:

```powershell
./scripts/configure-central-tasks.ps1 -ProjectRef 'PROJE_REF' -DatabaseHost 'CONNECT_EKRANINDAKI_HOST'
```

İstendiğinde **metis_reader parolasını yalnızca terminale** gir. Ana proje parolası veya publishable key burada kullanılmaz. Yardımcı parolayı gizler ve komut satırı argümanına koymaz. Ayarlar .NET User Secrets içinde, repo dışında saklanır. Bu geliştirme deposu **şifreli değildir**; Windows kullanıcı erişimiyle korunur, production secret manager yerine geçmez. [Microsoft açıklaması](https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets?view=aspnetcore-10.0).

API uzak bağlantıda sertifika ve host doğrulaması (`VerifyFull`) yapar. Özel kök sertifika gerekirse Supabase panelinden alınan sertifikanın mutlak yolunu `-RootCertificate 'C:\...\root.crt'` ile ekle. TLS doğrulamasını kapatma. Doğrudan IPv6 bağlantısında host `db.PROJE_REF.supabase.co` kullanılabilir; yardımcı kullanıcı adını `metis_reader` seçer. Transaction pooler 6543 bu dilimde kabul edilmez.

API'nin açık terminalinde Ctrl+C, sonra:

```powershell
npm.cmd run dev:api
```

Masaüstü public ayarlarını değiştirmediysen yeniden derleme gerekmez. Backend User Secrets yalnızca Development ortamında otomatik okunur. Ortam değişkenleri bu ayarları geçersiz kılabilir; eski `CentralTasks__*` override'larını kullanma.

## 3. Doğrulama sınırı

`GET /health` yalnızca API sürecini kontrol eder. Gerçek okuma hazırlığı, geçerli kullanıcı Bearer oturumu isteyen `GET /api/v1/tasks/status` yanıtındaki `storage: ready` ve `readAvailable: true` ile anlaşılır. Tokenları sohbete veya terminal geçmişine kopyalama. Bu dilimde masaüstüne merkezi görev ekranı eklenmedi; canlı kullanıcıyla bu son kontrol, yerel ayarlar hazır olduğunda birlikte tamamlanacak.

`notConfigured`: sağlayıcı kapalı. `unavailable`: bağlantı, parola, TLS, migration, rol yetkileri veya proje eşleşmesi başarısız. Ayrıntılar/parolalar HTTP yanıtında gösterilmez. Yeni kurulumda merkezi görev tablosu boştur; yereldeki görevlerin orada görünmemesi beklenir. `syncAvailable` bu sürümde her zaman false.

Bağlantıyı verileri silmeden devre dışı bırakmak için:

```powershell
dotnet user-secrets set CentralTasks:Provider Disabled --project services/api
```

Ardından yerel API'yi yeniden başlat. Kimlik doğrulama ve yerel görevler çalışmaya devam eder.
