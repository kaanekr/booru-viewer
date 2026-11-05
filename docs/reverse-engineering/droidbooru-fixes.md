# Droidbooru incelemesi sonrası düzeltmeler

Dal: `fix/droidbooru-stability`  
Tarih: 2026-10-16

## Yeni mekanikler

- **Slayt kontrolü:** Viewer alt çubuğundaki oynat/duraklat düğmesi gönderileri
  3,5 saniyede bir ilerletir. Son gönderide durur; son gönderiden yeniden
  başlatılırsa ilk gönderiye döner. Tek gönderilik listede düğme devre dışıdır.
- **Gönderiye atlama:** Viewer üstündeki kaynak/sayaç alanına dokununca gönderi
  numarası girilebilir. Sınır kontrolü yapılır. Ek bir native Modal açılmaz.
- **Kaynağa bağlı etiket araması:** Viewer'daki etiket araması, ekleme ve hariç
  tutma işlemleri o gönderinin kaynağında açılır. Kaynak snapshot'ı gezinme
  parametrelerine aktarılır; global kaynak seçimi değiştirilmez.

## Düzeltilenler

### Favoriler, geçmiş ve yedekler

- Ortak `getPostKey()` kaynak kimliği ile gönderi ID'sini birlikte kullanır.
  Farklı kaynakların aynı ID'li gönderileri birbirini silmez veya aynı favori
  rozetini paylaşmaz. Karma favori/geçmiş listesinden doğru gönderi açılır.
- Eski AnimeBoxes sayısal booru ID önekleri, kayıtlar yeniden yazılmadan canlı
  ID'lerle eşleştirilir. Kimlik fonksiyonu, eksik kaynak kimliği için global
  seçili kaynağı varsaymaz.
- Favori, etiket, geçmiş ve bölüm ilerlemesi için aynı depolama anahtarına yapılan
  oku/değiştir/yaz işlemleri sıraya alınır.
- Favori yazma hatası artık başarılı bir silme gibi `false` dönmez. Viewer hata
  gösterir, kalp durumunu başarılıymış gibi değiştirmez ve yeniden denemeye izin verir.
- Yedek birleştirme ve otomatik onarım da aynı kuyrukları kullanır; araya giren
  kullanıcı işlemleri eski snapshot'la ezilmez. Farklı kaynaklardaki eşit ID'ler
  içe aktarmada korunur.
- Son görüntülenenler önbelleği ancak disk yazması başarılı olunca değişir.
  500 kayıt sınırı en eski yerine **en yeni** kayıtları korur.
- Favorites ekranındaki callback bağımlılığı nedeniyle veri uzunluğu değişince
  tekrar tekrar çalışan yükleme döngüsü kaldırıldı.

### Viewer ve gezinme

- Kapanış ve etiket callback'leri sabitlendi. Çift kapanış eylemi iki route'u birden
  pop etmez. Alt bileşene verilen kapanış/kontrol callback'leri de sabitlendi.
- Hook'lar görünürlük kontrolünün üstüne taşındı; mounted Viewer'ı gizlemek/açmak
  veya listeyi boşaltmak hook sayısını değiştirmez.
- Eski gönderiye ait gecikmiş favori okuma/yazma sonucu yeni gönderinin kalbini
  değiştiremez. Kalbe hızlı çift dokunma tek devam eden yazmaya indirgenir.
- Slayt interval'i görünürlük, suspend ve açık panelleri izler; ekran askıya
  alındığında durur ve dönüşte kendi kendine yeniden başlamaz.
- Askıdaki Viewer geçmişe yeni görüntüleme eklemez; detay paneli odak kaybında kapanır.

### RedGifs siyah/boş kapaklar

- Karttaki statik kapak ilk video karesi gerçekten çizilene kadar görünür kalır;
  `readyToPlay` tek başına kapağı gizlemez. Önizleme kapatılınca kapak geri gelir.
- Android'de önizleme için `textureView` kullanılır; kapak ile video aynı görünüm
  ağacında doğru sırada birleştirilir. Bu değişiklik cihazda da kontrol edilmelidir.
- RedGifs'in `poster` URL'si thumbnail'den ayrı `previewFallbackUrl` alanında tutulur
  ve yedek içe aktarmada korunur. Boş veya string olmayan thumbnail değerleri atlanır.
- Kapak başarısız olursa poster denenir; MP4/HLS/WebM dosyaları resim yükleyicisine
  yedek kapak olarak verilmez. Proxy yapılandırılmışsa en fazla dört farklı resim
  URL'si denenir. Hepsi başarısızsa sessiz siyah alan yerine hata metni gösterilir.
- Kontrol edilen beş canlı RedGifs thumbnail URL'si HTTP 200 ve `image/jpeg` döndü.
  Bu, kullanıcının cihazındaki ağın veya her kapağın sağlıklı olduğunu kanıtlamaz.

### Arama ve ağ

- Feed ve Search API çağrıları explicit kaynak taşır. Etiketten açılmış bir
  sonuç ekranı başka bir global kaynak seçimi yüzünden farklı provider kullanmaz.
- Aynı sunucuya eşzamanlı istekler artık aynı bekleme süresinden birlikte uyanmaz;
  ortak booru transport'unda her deneme için ayrı 800 ms başlangıç aralığı ayrılır.
  Farklı origin'ler birbirini bloke etmez. Çağıranın AbortSignal'ı korunur.
- RedGifs sonuçlarını bütün ekranlar arasında tüketen global “görüldü” kümesi
  kaldırıldı. Tekilleştirme her listenin kendi state'inde yapılır.
- Eski aramanın hata veya finally bloğu yeni aramanın sonucunu/yükleyicisini
  değiştiremez. Unmount sonrası sonuçlar geçersiz sayılır.
- Arama sayfalaması aynı anda tek isteğe izin verir, yalnızca başarıda sayfa
  ilerletir ve boş/tekrarlanan sayfada durur. Hatalı sayfa yeniden denenebilir.
- Tamamlanmış eski autocomplete isteği yeni sorgunun önerilerini ezemez.
- RedGifs'in uygulama içindeki `real_couples` gibi etiketleri arama ve autocomplete
  isteklerinde `real couples` biçimine çevrilir. Kullanıcı/kategori kimlikleri,
  yerel hariç tutma filtresi ve diğer booru kaynaklarının alt çizgileri korunur.
  Canlı API karşılaştırmasında iki istek de HTTP 200 döndü: alt çizgili sorgunun
  toplamı 0, boşluklu sorgunun toplamı 10.000 idi (`count=1`, yalnızca durum ve
  sonuç sayıları incelendi). Bu sayılar kontrol anına aittir.

### Kaynaklar arası önizlemeler

- 13 kaynak için liste alanları, kart oynatıcısı, kare alternatifleri, yedek
  normalizasyonu ve görünürlük hesabı tarandı. CDN çapındaki kalıcı hata engeli,
  atlanan ayrı video sample'ları, ilk-kare takılmaları ve kaydırma koordinatları
  düzeltildi. Tam videoların otomatik indirilmemesi korundu.
- Kaynak bazında yetenekler ve doğrulama sınırları:
  [Önizleme tarama raporu](preview-source-audit.md).

### Kilit ve gizlilik

- iOS `inactive` durumunda biyometrik kilit ekranı yeniden açılmaz; içerik düz bir
  gizlilik katmanıyla örtülür ve medya izni kapanır.
- `background` durumunda otomatik kilit devam eder. Güvenlik sorgusu sürerken
  uygulama öne gelse de içerik örtülü kalır. Eski sorgu yeni sorgunun örtüsünü kaldıramaz.
- PIN algoritması ve biyometri servisi bu değişiklikte yeniden tasarlanmadı.

## Doğrulama

- Başlangıçtaki mevcut suite: **104 test**.
- Depolamadaki ilk dokuz regresyon testi düzeltmeden önce başarısız, sonra başarılı.
- Son `npm run test:freeze`: **175/175 başarılı**; başlangıca göre 71 ek test.
- `tsc --noEmit`: başarılı.
- `expo export --platform android`: üretim Metro + Hermes paketi başarılı.
- `expo export --platform ios`: üretim Metro + Hermes paketi başarılı.
- Git whitespace kontrolü: başarılı.

Paketleme, APK/IPA üretimi veya uygulamanın cihazda çalıştırılması değildir.
Testler gerçek uygulama modüllerini çalıştırır; native bileşenler, ağ ve depolama
sınırlarında kontrollü taklitler kullanılır. Uzun süreli native donmanın kök
nedeninin giderildiği bu sonuçlarla iddia edilmez.

## Cihazda denenmesi gerekenler

1. Fotoğraf/video görüntülerken hızlı aç/kapat, geri gesture ve timeline seek.
2. Slaytı başlat; etiket aramasına, başka sekmeye ve arka plana geç. Dönüşte
   kendiliğinden ilerleme olmamalı. Sayaca dokunup ilk/son gönderiye atla.
3. Farklı kaynaklardan favori ekle/kaldır; Favorites ve History'den doğru içerik
   açılmalı. Eski `.abbj` dosyasını içe aktarıp mevcut favorilerin korunduğunu kontrol et.
4. Face ID/Touch ID/PIN açıkken bildirim merkezi, sistem diyaloğu ve uygulama
   değiştiriciyi dene. Örtü önde kalmamalı; gerçek arka plan dönüşünde kilit çalışmalı.
5. Arama sırasında sorguyu veya kaynağı değiştir, hızlı kaydır, bağlantıyı kesip
   yeniden dene. Eski hata yeni sonucu silmemeli; sayfa atlanmamalı.

## Çalışma ağacı notu

Dal, kullanıcının mevcut değiştirilmiş çalışma ağacı korunarak açıldı. Önceki
değişiklikler commit edilmedi, geri alınmadı ve push yapılmadı. Bu geçişte yapılan
düzeltmeler de henüz commit edilmedi; dal değiştirirken uncommitted değişiklikler
çalışma ağacıyla birlikte taşınır.

İlk incelemenin statik APK kanıtları ve kapsam sınırı için:
[Ana şablon raporu](droidbooru-2.1.0-template.md).
