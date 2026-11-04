# Modül sınırları

M0.4'te `Identity`, yapılandırma doğrulaması ve Supabase public JWKS üzerinden sunucu JWT doğrulaması içerir. Varsayılan sağlayıcı `Disabled`; gerçek proje henüz bağlanmadı. Giriş/yenileme/saklama akışı ve iş modülleri uygulanmadı. İş modülleri `Modules/<Name>` alanında endpoint, iş kuralı ve veri erişimini birlikte tutacak. Bir modül başka modülün tablolarına doğrudan yazmayacak; açık uygulama sözleşmeleri kullanılacak. Tek ASP.NET Core süreci, tek dağıtım birimi korunacak. Modüller somut ihtiyaç oluşunca ayrı C# projelerine taşınabilir.

Planlanan iş endpoint'leri `/api/v1/<module>` altında olacak. `/health` operasyonel ve sürümsüzdür; veritabanı, kimlik sağlayıcısı veya sync sağlığını bildirmez.
