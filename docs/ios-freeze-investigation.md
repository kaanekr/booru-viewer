# iOS donması — 29 Eylül 2026

Dal: `fix/ios-player-lifecycle`, başlangıç: `main` / `8403404`.

## Kodda doğrulanan kusurlar ve düzeltmeler

- `PostCard`, resim kartlarında da `useVideoPlayer(null)` çağırıyordu. Bu
  çağrı native oyuncu oluşturur. Artık yalnız aktif video çocuğu oyuncu kurar.
- MP4 kapak ile video önizlemesi aynı kartta iki oyuncu açabiliyordu. Tek
  video yolu kullanılıyor; görünürlük kaybolduğunda çocuk unmount olur.
- Keşfet/Arama önizlemelerinin görünürlük hesabı ekran odağını içermiyordu.
  Sekme/stack odağı, uygulamanın ön planda olması ve uygulama kilidi artık
  hesaba katılır. Dokunmayla başlamış önizleme de odak kaybında temizlenir.
- Gerçek önizleme videosu varken video oynar (tek oynatıcı); kare dizisi
  yalnız videosuz kartın fallback'idir. Ara sürümde slayt videoyu eziyordu:
  XHamster'da 2 benzer kare 500ms'de titriyor, XVideos'ta video kayboluyordu.
  Video aktifken slayt zamanlayıcısı da durur (gereksiz re-render yok).
  Video gereken kartlarda hata sonrası en fazla bir proxy geçişi vardır;
  terminal hatada oyuncu kaldırılır.
- Grid'deki senkron `replace()` ve zamanlayıcılı tekrar denemeler kaldırıldı.
  Sessiz önizlemelerde ses karışımı açıkça `mixWithOthers`; native video
  dokunmaları ve Live Text analizi kapalı.
- Keşfet'te eski kaynak/sıra istekleri yeni listeyi ve yüklenme durumunu
  değiştirebiliyordu. İstek kimliği ve kaynak anahtarı kontrol ediliyor.
  Boş/tekrarlanan sayfa otomatik sayfalamayı durduruyor; yenileme tekrar açıyor.
- İzleyicide çözülmüş orijinal URL (WebM) öncelik sırasını atlayıp doğrudan
  oynatıcıya gidiyordu: guard listedeki MP4'ü görüp geçiyor, oyuncu WebM'i
  alıp AVFoundation -11828 uyarı fırtınası üretiyordu (realbooru vakası).
  Birincil seçim `selectPrimaryVideoCandidate` (`media.ts:586`) altında toplandı:
  iOS'ta açılamayan çözülmüş URL atlanır, sıradaki oynatılabilir aday oynar
  (`ImageViewerModal.tsx:776`). `VideoPlayerView` ayrıca unmount sonrası biten
  async devamlarında bırakılmış oyuncuya dokunmaz (NotFoundException gürültüsü
  bitti) ve desteklenmeyen URL'yi yüklemeden hata kartına düşer.
- Ayarlar > Görsel Kalitesi altında "Video Önizlemeler" anahtarı:
  kapalıysa ızgara kartları statik kapak gösterir, hiç oyuncu kurulmaz
  (`src/utils/gridPreviews.ts`, `PostCard.tsx:109`). İzleyici oynatmayı etkilemez.
- Keşfet/Arama `ScrollView` tüm kartları mountluyordu (`n=120-148`).
  Ekran + 1500px overscan dışındaki kartlar artık yer tutucu `View`e düşer
  (`src/utils/gridVisibility.ts:52`, `FeedScreen.tsx:469`,
  `SearchScreen.tsx:1166`). Mount sayısı ~20'de kalır, kaydırma
  yüksekliği korunur. Donma kaydında `delay 432ms -> 1329ms` ve `touch`
  dengesizliği (`162/159`) liste büyürken çıkmıştı.

## Doğrulama

- `npm run test:freeze`: 17 regresyon testi. 200 fotoğraf kartı, çift oyuncu,
  odak kaybı, kare önizlemesi, terminal hata, yanlış JPEG kaynağı, geç kalan
  kaynak yanıtı, tekrarlanan sayfa, eski isteğin `finally` yarışı, 6 RedGifs
  token yarışı ve 2 mount-penceresi testi (148 kartta pencere boyutu, toplam
  yükseklik korunumu, pencere kayması).
- `npx tsc --noEmit`: başarılı.
- iOS production bundle export: başarılı.
- Testlerde native API'ler taklit edilir. Donma giderimi cihaz testiyle
  doğrulanmalı: aynı turda `n=120+` sonrası takılma olmamalı.

## Önceki teşhislere düzeltme

Açık TCP bağlantısı reload'un cihazda işlendiğini kanıtlamaz. FPS değerlerinin
değişmesi de tek başına deadlock/livelock ayrımı yaptırmaz. Önceki heartbeat
Metro logundan önce senkron dosya okuduğu için iki çıktının susması iki bağımsız
ölçüm değildi. Önceki rapordaki kesin thread/livelock hükümleri doğrulanmış değil.

Bu oturumdaki CDP sorguları zaman aşımına uğradı; kullanıcı telefonun arka
planda/kapalı olduğunu belirtti. Bu ölçüm donma kanıtı olarak kullanılmadı.

## Cihaz testi

1. Expo Go'yu tamamen kapatıp yeniden aç. Başlangıçta
   `[FreezeProbe] ios-player-lifecycle-v2-windowed` görülmeli.
2. RedGifs'te birkaç sayfa gez, Viewer'a gir/çık, Ayarlar'a geç, XVideos'a dön.
3. Ayarlar'da `players=0` beklenir. Sayaç JS tarafında mount olmuş grid video
   bileşenlerini sayar; native belleğin tamamen boşaldığını ölçmez.
4. Donarsa uygulamayı önde tut. Son `[FreezeProbe]` satırını kaydet. `tick`
   ilerliyor mu, dokunurken `touch` sayaçları değişiyor mu kontrol et.
5. React Native DevTools konsolunda `globalThis.__freezeProbe()` son 30 olayı
   ve sayaçları verir. Bu sorgu yalnız telefon ön plandayken yorumlanmalı.

Yeni ölçüm yalnız development modunda çalışır, diske yazmaz ve medya URL'lerini
kaydetmez. Kök dokunma sayaçları ayrı native Modal pencerelerini kapsamaz.
