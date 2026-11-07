# Modül sınırları

API tek ASP.NET Core modüler monolit sürecidir. Identity, Supabase public JWKS ve JWT doğrulamasını sağlar. Tasks, merkezi görev modelinin yalnızca okuma erişim sınırını sunar. Her modül kendi endpoint/iş kuralı/veri sözleşmesini tutar; başka modülün tablolarına doğrudan yazmaz.

Merkezi Tasks için üretim veri kaynağı henüz yapılandırılmadı. Sahte başarılı store yoktur. `GET /api/v1/tasks/status` oturum gerektirir; `readAvailable=false`, `syncAvailable=false` döner. Liste/detay okuması oturum yoksa 401, doğrulanmış oturumla bağlantı henüz yoksa 503 döner. Merkezi yazma endpoint'i eklenmedi. Masaüstü Tasks hâlâ Windows SQLite komutlarını kullanır.

PostgreSQL modeli `../Database` altındadır ve canlı projeye uygulanmadı. JWT `sub` değeri sunucuda doğrulanır; query/header kullanıcı kimliği yetkilendirme sağlamaz. İleride gerçek reader, zorunlu sahip parametresi ve en az yetkili DB rolüyle uygulanacak.

`/health` yalnızca süreç canlılığıdır; veritabanı veya eşitleme hazırlığını ölçmez. Bağlantı, merkezi yazma ve sync yeni onaylı dilimlerdir.
