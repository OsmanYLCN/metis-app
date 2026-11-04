# ADR-0007 — Kullanıcı seçimiyle cihaz oturumu

4 Kasım 2026 · Metis 0.7.0

Windows giriş formunda varsayılan olarak kapalı “Bu cihazda oturumumu hatırla” seçeneği vardır. Seçilmezse refresh token tutulmaz; varsa eski cihaz kaydı yeni girişte silinir. Tarayıcı önizlemesinde native kasa yoktur ve seçenek sunulmaz.

Seçilirse yalnızca refresh token, API'nin access tokenı doğrulamasından sonra M0.6 DPAPI kasasına yazılır. Access token yalnızca bellektedir. Parola, tokenlar veya kullanıcı kayıtları browser storage/SQLite'a yazılmaz. Refresh token, doğrudan sağlayıcı isteği için kısa süreli WebView/JS belleğinde bulunur; renderer'dan tamamen izole bir token aracısı uygulanmış değildir.

## Native sınır

`session_vault_read/write/clear` komutları yalnızca yerel main pencereye açılır. Frontend dosya yolu veremez; host app-local `sessions/` dizinini seçer. Public proje referansı doğrulanır, hash ve DPAPI bağlamı olarak kullanılır. Native mutex işlemleri sıraya koyar. Her proje için process ömrü boyunca paylaşılmayan bir Windows dosya handle'ı tutulur; ikinci uygulama aynı projedeki oturum kasasını açamaz. Kilit başarısızsa hata gösterilir; şifresiz saklamaya geçilmez. Lock dosyasının diskte kalması kilitli olduğu anlamına gelmez; asıl kilit açık Windows handle'ıdır.

## Geri yükleme ve yenileme

API issuer ön kontrolü geçmeden sağlayıcıya token gönderilmez. Kasa okunur; kayıt varsa sağlayıcı refresh grant'i ile yeni token çifti alınır. Yeni access token yine API'ye doğrulatılır. Başarılı doğrulama sonrası yeni refresh token eskisini atomik olarak değiştirir ve oturum açılır. Süre bitmeden yenileme yapılır; odak/uykudan dönüş kontrolü de aynı tekil akışı kullanır. Aynı anda ikinci yenileme başlatılmaz. Açık oturumun yenilenmesi sırasında doğrulanan kullanıcı ID'si değişemez.

Ön kontrolde ağ/API hatası olursa kayıt korunur ama açık oturum gösterilmez. Sağlayıcıya yenileme isteği gönderildikten sonraki belirsiz hata, timeout veya ret durumunda eski token yeniden kullanılmaz; kasa temizlenir ve yeni giriş gerekir. Bu, bazı ağ kesintilerinde tekrar parola girilmesini gerektiren bilinçli ilk sürüm davranışıdır. Otomatik sonsuz retry yoktur. Kayıtlı oturumu yeniden açma ve açıkça silme düğmeleri vardır.

## Çıkış ve eşzamanlılık

Her giriş/yenileme denemesi bir generation taşır. Çıkış/iptal generation'ı değiştirir; eski yanıt oturum açamaz. Frontend disk işlemleri de sıraya alınır: başlamış yazma tamamlandıktan sonra logout temizliği çalışır. Yazma/kasa hatası başarılı kalıcı oturum gibi gösterilmez. Silme hatası açıkça bildirilir ve kullanıcı tekrar silebilir; böyle bir hatada diskte kayıt kalmış olabilir.

Çıkış önce bellek erişimini kapatır, sonra cihaz kaydını siler ve varsa access token ile sağlayıcıya local-scope revoke gönderir. Kapatma/reload ise belleği bırakır ve kullanıcının açıkça istediği şifreli kaydı korur. Yenileme esnasındaki ani süreç kapanışında yeniden giriş gerekebilir. JWT anlık iptal sınırı ve DPAPI'nin aynı Windows hesabındaki süreçlere karşı izolasyon sağlamaması geçerlidir.

Kaynaklar: [Supabase oturum ve refresh sözleşmesi](https://supabase.com/docs/guides/auth/sessions), [Tauri izin modeli](https://v2.tauri.app/security/permissions/).

## Doğrulama sınırı

Kullanıcı Supabase kurulumunu sonraki güne bıraktı. Canlı bağlantı ve gerçek hesap testi yapılmadı. Sağlayıcı yenilemesi/UI testlerinde mock; DPAPI, dosya kilidi ve native IPC testlerinde gerçek Windows kullanıldı. İş modülleri ve sync hâlâ sonraki kapsamdır.
