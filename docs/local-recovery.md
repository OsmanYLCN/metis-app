# Yerel geri dönüş noktaları

## Kullanım

1. Windows Metis uygulamasında hesabına giriş yap.
2. Sol menüden **Veri ve eşitleme** aç.
3. **Şimdi yerel yedek al** seç. Oluşturulan dosya listede görünür.
4. Yedeği geri almak için **Geri yüklemeyi incele** seç. Mevcut kayıt sayılarıyla yedekteki sayıları karşılaştır.
5. İstersen vazgeç. Devam etmek için GERİ YÜKLE yaz ve Yerel veriyi geri yükle düğmesine bas.

İşlem seçili hesabın yerel kayıtlarını değiştirir. Diğer hesaplar ve sunucu verisi değişmez. Yerine yazmadan önce o anki durum ayrı güvenlik yedeğine alınır. Geri dönüş tek SQLite transaction’dır; bir kaydı yazmak başarısız olursa tüm değişiklikler geri alınır.

## Gönderim neden duraklar?

Yedek eski bir tarihe aittir; buluttaki veri daha yeni olabilir. Restore sonrasında native recovery_guard hem elle hem otomatik tüm gönderimleri engeller. Veri ve eşitleme ekranındaki kurtarma bölümü güncel bulutu tamamen okuyup karşılaştırır. Açık onayla bulut sürümleri uygulandıktan ve son kontrol eşleştikten sonra kilit açılabilir. [Adım adım uzlaştırma](automatic-sync-recovery.md). Normal kullanımda yalnızca yedek almak gönderimi durdurmaz.

Sonucu belirsiz bir gönderim varsa önce aynı işlem kimliğiyle sonucu doğrulanmalıdır. Restore bu durumda reddedilir. Önizlemeden sonra veri değişirse yeni önizleme gerekir.

## Dosya kapsamı

Dosyalar yerel storage/backups/<hesap özeti>/ altında .metisbackup uzantısıyla saklanır. Arayüz gerçek klasör yolunu gösterir. Son 30 dosya listelenir; eski dosyalar otomatik silinmez. Tek dosyanın düz metin içeriği en çok 32 MiB, her tablo en çok 200.000 satırdır. Sınır aşılırsa eksik yedek oluşturulmaz; hata döner.

Yedek formatı 1 / SQLite şema 14 (şema 13 yedekleri de okunur). Görev ilişkileri ve gönderim geçmişi dahil; oturum tokenları, API anahtarları, DB parolaları ve uygulama ayarları hariç. Başka hesapla geri yükleme reddedilir.

DPAPI bu Windows kullanıcı profiline bağlıdır. Aynı diskteki yedek disk arızasını çözmez; farklı yere kopyalanabilir ancak profil/cihaz kaybında açılamayabilir. Bu sürüm taşınabilir dışa aktarma veya bozuk SQLite dosyasını otomatik onarma sağlamaz. Yerel SQLite’ın kendisi şifrelenmez.

## Güvenlik ve bütünlük

Native host dosya yolunu seçer; web arayüzü keyfi dosya yolu veya SQL veremez. Dosya yalnızca şifreli halde diske yazılır. Dosya yazımı tamamlanmadan listede görünmez. Restore öncesinde DPAPI, format/hesap/şema, satır yapıları ve önizleme digest’leri doğrulanır; DB constraint ve foreign-key kontrolü başarısızsa rollback olur.

Testler geçici veride çalışır. Kullanıcının canlı yedeği oluşturulmadı veya geri yüklenmedi.

Şema 14 güncellemesi: yedekler cloud_bindings merkezi sürüm bağlantılarını da içerir. Şema 13 yedekleri boş bağlantılarla okunur; geri dönüş gönderim kilidini korur. Seçilen bulut kopyasını yerelde uygulama öncesinde aynı mekanizmayla otomatik güvenlik yedeği alınır. Ayrı cloud-inbox dosyası kalıcı outbound isteklerini de içerir ve bu yedeğe dahil değildir. Bu dosyayı silmeyin; çözülmemiş outbound isteği varken geri yükleme reddedilir.
