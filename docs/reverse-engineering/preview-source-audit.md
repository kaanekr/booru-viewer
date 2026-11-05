# Tüm kaynaklarda kart önizleme taraması

Tarih: 2026-10-16 · Dal: `fix/droidbooru-stability`

## Kapsam

`sources.ts` içindeki 13 kaynağın liste eşlemeleri, ortak `PostCard`, Feed/Search
görünürlük hesabı ve yedek içe aktarma incelendi. Aşağıdaki bilgiler mevcut
uygulamanın adaptörlerine aittir; sitelerin her zaman bu verileri sağlayacağı
veya her CDN'in cihazdan erişilebilir olduğu anlamına gelmez.

| Kaynak | Mevcut adaptörde önizleme verisi / davranışı |
| --- | --- |
| Gelbooru | Resim kapak; API ayrı oynatılabilir video sample verirse otomatik klip. |
| Rule34 | Gelbooru eşlemesi; video sample iOS uyumluysa oynatılır, WebM iOS'ta atlanır. |
| Danbooru | `preview_file_url` kapak; `large_file_url` video ise ayrı sample olarak denenir. Tam dosyayla aynıysa yalnızca basılı tutmada. |
| Yande.re | `preview_url` / `sample_url`; çoğunlukla statik resim. Sample GIF varsa resim katmanında animasyon. |
| Realbooru | HTML kapak; doğrulanmış veya adaptörce tahmin edilmiş video adresi sample/original alanlarına giriyor. Aynı tam dosya otomatik açılmaz; tahmin edilen adresin erişilebilirliği garanti değil. |
| Cum.st | WebP kapak; sample ve original aynı tam ek dosyası. Ayrı kısa klip yok; videoda basılı tutma, otomatik tam-video indirmesi yok. |
| RedGifs | Thumbnail + bağımsız poster; sessiz/SD klip, varsa sonraki SD sample alternatifi. |
| XVideos | `data-pvv` / JSON `previewVideo`; numaralı thumbnail kareleri alternatif. İki HTML kart biçimi de kontrol edildi. |
| XHamster | HTML/başlangıç JSON'undan klip ve kapak. Klip yoksa statik kapak; mevcut AV1→H264 adres dönüşümü CDN'de dosya bulunduğunu kanıtlamaz. |
| Pornhub | Webmasters API yolunda thumbnail kareleri; HTML yolunda ayrıca klip. iOS WebM'yi atlayıp karelere döner. |
| Sex.com | `<video>` klibi ve kapak; kaynak yapılandırmada gizli olsa da ortak politika kapsamında. |
| HentaiHaven | Liste eşlemesinde yalnızca seri/bölüm kapağı; bölüm stream çözümlemesi viewer'a ait. |
| nhentai | Manga kapağı; video önizlemesi yok. |

Favoriler ızgarası mevcut tasarımda otomatik odak/görünürlük prop'ları vermiyor:
statik kapak + basılı tutma kullanıyor. Bu taramada favorilere otomatik oynatma
eklenmedi. Viewer'ın ayrıntı sayfasından stream çözümlemesi de değiştirilmedi.

## Düzeltilen ortak hatalar

- **CDN çapında kalıcı engel:** Tek bozuk klip artık aynı host'taki bütün kartları
  oturum boyunca kapatmıyor. Yalnızca hatalı URL 30 saniye beklemeye alınır;
  en fazla 256 hata kaydı tutulur. Sonraki odak/render işlemi yeniden deneyebilir.
- **Atlanan sample adresleri:** Ortak yardımcı, platforma uygun açık klibi ve ayrı
  video sample'ı sırayla seçer. Aynı URL tekrarlanmaz. Tam dosyanın sample'a alias
  edilmesi otomatik indirme korumasını aşamaz; basılı tutma tam videoya izin verir.
- **Sonsuz ilk-kare beklemesi:** İlk kare 15 saniyede çizilmezse oynatıcı bırakılır;
  başka aday, kare dizisi veya kapak kalır. `readyToPlay` kapağı gizlemez.
- **Yanlış kaydırma koordinatları:** Feed/Search ızgarasının gerçek üst konumu
  scroll offset'inden çıkarılır; pencere yüksekliği ekran sabiti yerine ölçülür.
  Böylece üstteki filtre/başlık, odaklanan kartları kaydırmaz.
- **Görünürlük/memo:** Açıkça ekran dışında kalan kart, eski odak prop'u hâlâ
  açık olsa bile player'ı kapatır. Görünürlük verilmemesi ile `false` ayrılır.
  Odak hook'larının debounce zamanlayıcıları unmount'ta temizlenir.
- **Bozuk kareler:** Kare URL'leri normalize/tekilleştirilir; video URL'leri resim
  katmanına girmez. Hatalı kareler atlanır, hepsi başarısızsa kapak görünür kalır.
  Kare animasyonu da resim yükleme kapısına ve ekran odağına uyar.
- **Yedeklerde kayıp:** `previewVideoUrl`, `previewThumbUrl`, `previewThumbs`
  içe aktarma/onarım normalizasyonunda korunur.
- **XVideos:** `THUMBNUM` gerçek kapak numarasına çevrilir; iki kart biçiminde de
  kareler üretilir. Protokolsüz/göreli adresler ve HTML-escaped klip query'leri
  normalize edilir. İki regresyon testi düzeltme öncesinde başarısızdı.

## Doğrulama ve sınırlar

- `npm run test:freeze`: **175/175** test.
- `tsc --noEmit`: başarılı.
- Android + iOS üretim Metro/Hermes export'u: başarılı.
- Ortak politika testindeki 13 kaynak örneği kontrollü metadata kullanır;
  **13 sunucuya canlı erişim veya native codec testi değildir**.
- İlk-kare zaman aşımı, başarısız klipten sample'a geçiş, CDN hata izolasyonu,
  cooldown, kare hataları, gerçek ekran koordinatlarının aktarımı ve zamanlayıcı
  temizliği regresyon testleriyle kontrol edildi.

Cihaz kontrolü: Uygulamayı yeniden yükle ve listeleri yenile. Önizlemeler ayarı
açıkken Feed ve Search'te hızlı kaydır; geri dönünce doğru kartların oynadığını
kontrol et. Klip olmayan kaynaklarda statik kapak normaldir. Sorun sürerse kaynak,
örnek gönderi, cihaz/OS ve hata anındaki ağ bilgisi gerekir. Cihazdaki ilk-kare
olayı, sertifika/codec davranışı ve uzun oturum kararlılığı henüz doğrulanmadı.
