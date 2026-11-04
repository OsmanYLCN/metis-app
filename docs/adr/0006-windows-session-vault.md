# ADR-0006 — Windows oturum kasası altyapısı

Tarih: 2026-11-04 · M0.6 ilk dilimi, sürüm 0.6.0

## Karar

`src-tauri/src/session_vault.rs`, oturum sırrını saklamak için özel bir native adaptör sağlar. Windows DPAPI (`CryptProtectData` / `CryptUnprotectData`) mevcut Windows kullanıcısı kapsamında çalışır; makine-geneli erişim bayrağı kullanılmaz. İlave parola veya bulut servisi gerekmez. Public proje referansı hem dosya adının hash'ine hem DPAPI ek bağlamına katılır. Bir projenin dosyasını başka proje adına taşımak çözme işlemini başarılı yapmaz.

Yalnızca şifreli veri diske gider. Kayıt önce aynı dizinde özel oluşturulmuş geçici dosyaya yazılır, flush edilir ve Windows replace işlemiyle yerine alınır. Hata mevcut kaydı korur; hata alınan geçici dosya temizlenmeye çalışılır. Süreç aniden kapanırsa geride şifreli geçici dosya kalabilir. Diskin fiziksel arızasına karşı yedekleme/kalıcılık garantisi verilmez.

Boş veya 8 KiB'dan büyük sır, mutlak olmayan kök ve geçersiz proje referansı reddedilir. Okuma 32 KiB ile sınırlandırılır; sürümlü payload başlığı kontrol edilir. Olmayan kayıt `None`, okunamayan/bozuk kayıt hata döndürür; otomatik silme/sıfırlama yapılmaz. Silme yalnızca ilgili projenin dosyasına uygulanır ve tekrarlanabilir.

Çözülmüş belleği tutan `Secret` türü Debug/Display/Serialize/Clone sağlamaz; bırakılırken belleği volatile yazımla temizler. Windows çıktısı da temizlenip LocalFree ile serbest bırakılır. Bu yaklaşım bütün süreç kopyalarının, işletim sistemi belleğinin veya çağıranın tamponlarının temizlendiği garantisi değildir. Aynı Windows hesabıyla çalışan zararlı süreçlere karşı izolasyon sağlamaz; DPAPI'nin kullanıcı/profil sınırları geçerlidir.

## Bu dilimin bilinçli sınırı

Adaptör **henüz giriş akışına veya Tauri IPC'ye bağlı değildir**. Normal uygulama çalışırken oturum dosyası oluşturmaz; M0.5'teki bellek oturumu devam eder. Kullanıcıya “beni hatırla” sunulmaz. Şimdilik modülde dead_code izni vardır; sonraki native entegrasyonda gerçek çağrılar eklenince kaldırılmalıdır.

Gelecek entegrasyon host'un belirlediği app-local dizini kullanmalı, IPC'den dosya yolu kabul etmemeli; kayıt/yenileme/çıkış işlemlerini sıraya koymalı ve eski yenileme yanıtının logout sonrası sır yazmasını engellemelidir. Saklanan sırın çözülmesi kullanıcı doğrulaması değildir: refresh sonrası API JWT kontrolü yine zorunludur. Aynı proje içinde hesap değişimi ve kullanıcı onayı da o dilimin kapsamıdır.

## Doğrulama ve kaynak

Gerçek Windows DPAPI ile sentetik veriler üzerinde disk round-trip, ayrı süreçten yeniden açma, proje bağlama, bozuk kayıt, sürüm/limit kontrolü, yazma/replace hataları ve silme test edildi. Başka Windows kullanıcısıyla erişim testi yapılmadı; bu sınır platform sözleşmesine dayanır.

[Microsoft CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata), [Microsoft CryptUnprotectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata).
