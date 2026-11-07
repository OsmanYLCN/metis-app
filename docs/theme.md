# Metis görünümü

2026-11-07: M0.7 üzerine yalnızca görünüm düzenlemesi. Koyu tema, antrasit ve nötr gri yüzeylerle güncellendi. Görev akışı veya başka ürün modülü eklenmedi.

## Renkler ve yazı tipi

| Alan | Koyu tema |
| --- | --- |
| Ana zemin / üst çubuk | `#212121` |
| Sol menü | `#171717` |
| Kart yüzeyi | `#262626` |
| Karşılama kartı | `#252525` |
| Seçili gezinme / ikon zemini | `#323232` |
| Ana metin / birincil düğme | `#ececec` |
| İkincil metin | `#b4b4b4` |
| Ayırıcı | `#363636` |

Renklerin kaynağı `apps/desktop/src/tokens.css`; koyu ve sistem modları aynı paleti kullanır. Açık temanın mevcut paleti korunur. Bağlantı kesintisi gibi durumların anlam taşıyan uyarı rengi korunur.

Font sırası: Segoe UI Variable Text, Segoe UI, system-ui, sans-serif. Windows'ta bulunan font kullanılır; harici font servisi, indirme veya yeni bağımlılık yoktur. Bu, referans arayüzün birebir kopyası değildir.

İkinci görünüm düzenlemesi: küçük metinler 1 px büyütüldü; gövde ağırlığı 450, menü/düğme ağırlığı 500 olarak ayarlandı. Başlık boyutları korundu. WebView2 kaydırma çubukları 10 px genişliğinde, şeffaf kenarlarla 6 px görünen yuvarlatılmış gri tutamaç kullanır; ok düğmeleri ve boyalı kanal kaldırıldı. Yüksek kontrast modunda sistem renkleri kullanılır. Kaydırma gizlenmez; fare tekerleği ve klavye çalışır.

Bu ikinci düzenlemenin güncel uygulaması `outputs/Metis-M0.7-ui.exe`. Önceki `Metis-M0.7.exe` çalıştığı için üzerine yazılmadı; açık kullanıcı uygulaması kapatılmadı.

## Doğrulama

- TypeScript + Vite üretim derlemesi başarılı.
- Tauri Windows Release derlemesi başarılı; `outputs/Metis-M0.7.exe` güncellendi.
- Edge üzerinde açık/koyu/sistem geçişleri ve açık temanın sistem koyu tercihine üstün gelmesi doğrulandı.
- 780 px ve 390 px genişlikte menü, modül gezinmesi ve yatay taşma kontrolü geçti.
- Koyu temada kontrol edilen açıklama metinleri, seçili gezinme ve birincil düğme kontrastı en az 7.29:1. Bu kontrol tam erişilebilirlik denetimi değildir.
- Masaüstü genişliği ve dar pencere ekran görüntüleri incelendi; tarayıcı çalışma hatası yok.
- Yazı/kaydırma düzenlemesinden sonra derleme ve görünüm kontrolleri tekrar geçti. 1200 × 760 pencerede sol menü fare tekerleğiyle, sayfa klavyeyle kaydırıldı; `outputs/metis-scrollbars.png` görüntüsü alındı.
- Görsel kontrolde API yanıtları mock kullanıldı; gerçek hesap, parola veya oturum okunmadı. SQLite ve kimlik doğrulama kodu değiştirilmedi, ilgili test paketleri bu görünüm düzenlemesinde yeniden çalıştırılmadı.

Yerel ekran görüntüleri: `outputs/metis-dark-theme.png`, `outputs/metis-light-theme.png`, `outputs/metis-dark-compact.png`. Çıktılar Git dışında tutulur. Önceki M0.7 kaynak ZIP'i tarihsel çıktıdır; bu düzenlemenin güncel kaynağı repodur.
