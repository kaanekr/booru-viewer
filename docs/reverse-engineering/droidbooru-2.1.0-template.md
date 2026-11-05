# Droidbooru 2.1.0 — Ana mimari şablonu ve repo karşılaştırması

Tarih: 2026-10-16

> Bu belge ilk inceleme anının kaydıdır. Daha sonra `fix/droidbooru-stability`
> dalında yapılan değişiklikler ve test sonuçları [düzeltme notlarında](droidbooru-fixes.md).

## Sonuç ve kapsam

APK'nin ana gezinme yapısı, kaynak/sorgu oturum modeli ve medya temizleme
sorumlulukları REA ile çıkarıldı. Aşağıdaki şablon bunları mevcut Expo projesine
uyarlayan bir tasarım önerisidir; APK'den geri kazanılmış bir Expo projesi değildir.
Uygulama kaynak kodu değiştirilmedi. APK kurulmadı veya çalıştırılmadı.

- APK: `C:\Users\PC\Downloads\Droidbooru2_1_0.apk`
- SHA-256: `013c2759fd73da4011d23a264d4b545573e02607aae2b22924a5c7539e912c13`
- Paket: `com.bisimplex.firebooru`, sürüm `2.1.0`, versionCode `119`
- minSdk: 26; targetSdk: 36
- JADX tarafından bildirilen: 8.552 sınıf, 1.596 kaynak
- Araçlar: REA 6.4.0, jadx-headless-mcp 0.7.1, mevcut JDK 25.0.4.1

**Kanıt sınırı:** Manifest ve sınıf üyeleri statik gözlemlerdir. Java metot
gövdeleri decompiler çıktısıdır; orijinal kaynak veya çalışma zamanı kaydı değildir.
Görsel ölçüler, gerçek cihaz performansı ve iOS davranışı doğrulanmadı. APK imzası
doğrulanmadı. Bu inceleme Droidbooru'nun hatasız olduğunu göstermez.

## 1. APK'den çıkarılan ana ekran şablonu

`MainActivity.createDefaultFragment()` doğrudan `HomeFragment` döndürüyor [E2].
Ana gezinme alt sekmelerle değil, `MaterialDrawerSliderView` yan menüsüyle kuruluyor
[E3]. Menü tıklamalarının gerçek hedefleri ayrıca incelendi [E4].

```text
MainActivity
├─ HomeFragment                  Ana sayfa / sabitlenen kaynak ve arama grupları
├─ Arama                         SourceQuery + seçilen provider
├─ Tümünü gez                    Kaynağın tüm içerik sorgusu
├─ Top / Hot                     Provider destekliyorsa görünür
├─ FavoriteListFragment          Yerel favoriler
├─ HistoryFragment               Geçmiş
├─ DownloadsFragment             İndirme listesi
├─ PoolServersFragment           Koleksiyon kaynakları
├─ ServersFragment               Kaynak yönetimi
├─ TagsBlackListFragment         Engellenen etiketler
└─ DynamicSettingsFragment       Ayarlar

Arama / liste → DetailFragment → medya sayfaları + bilgi/etiket paneli
```

Top ve Hot seçenekleri sabit değil: `getTopString()` ve `getBestString()` boş
değilse ekleniyor [E3]. Bu, Expo tarafında da her kaynağın desteklemediği filtreyi
göstermek yerine **kaynak yetenekleri** üzerinden UI kurmak için iyi bir örnek.

Home ekranında `SourceSpecs` ekleme, gruplama, yeniden adlandırma, sıralama ve
kaynak seçimi üyeleri var; alanları `RecyclerView` ve `HomeAdapter` içeriyor [E5].
Kesin kart görünümü, renkler ve ölçüler bu incelemede çıkarılmadı.

## 2. Veri akışının ana iskeleti

```text
Ekran / kullanıcı eylemi
       ↓
SourceQuery + BooruProvider
       ↓
SourceFactory → ayrı Source oturumu
       ↓
Sayfalama / ağ isteği / parser
       ↓
Normalize içerik listesi
       ↓
Liste ekranı veya DetailFragment
       ↓
PageView → IPageContentView / IVideoView
```

### Kaynak seçimi ile arama oturumunu ayır

`SourceFactory.createSource(type, provider, query)` ayrı `SourcePost`, `SourcePool`,
`SourceTag`, `SourceFavorites`, `SourceHistory` ve `SourceMultiPost` nesneleri
oluşturup anahtarlarıyla kaydediyor [E6]. Global factory var ama her aramanın
provider ve sorgusu oluşturulan oturuma veriliyor.

`Source` üyeleri; provider, query, data, currentPage, isLoading, isLastPage,
currentOperation, scheduledFuture ve listener içeriyor [E7]. `SourceQuery` içinde
metin, başlık, başlangıç sayfası, ek parametreler ve blacklist tercihi var [E8].

**Expo için öneri:** Seçili kaynak yalnızca yeni aramanın varsayılanı olsun.
Açılmış liste/viewer kendi kaynak ve sorgu snapshot'ını taşısın. Kaynağı
değiştirmek, geri yığındaki eski ekranların provider'ını değiştirmesin.

### Oturum kapatmanın tek sahibi olsun

`removeAllSources()` kalıcı olmayan kaynakları gezer, `cancelCurrentConnection()`
çağırır, listener'ı kaldırır ve kayıtları temizler [E9].

Ancak `cancelCurrentConnection()` içindeki koşul `!isExecuted()` içeriyor [E10].
Dolayısıyla bu kodu “çalışan bütün istekleri kesin durduruyor” diye kopyalamak
yanlış olur. Buradan alınacak desen, açık bir dispose sınırı olmasıdır; iptal
mantığının kendisi ayrıca test edilmelidir.

### Medya yaşam döngüsünü içerik UI'sından ayır

`PageView` bir `IPageContentView` tutuyor. `cleanup()` alt içeriği temizliyor;
`recycleContentView()` ayrıca referansları ve hazır bayraklarını sıfırlayıp alt
görünümleri kaldırıyor [E11, E12]. `destroy()` bu recycle metoduna gidiyor [E13].
`setVideoURL()` yalnızca içerik `IVideoView` ise video URL'sini iletiyor [E14].

`DetailFragment.onDestroy()` sayfa değişimi callback'ini kaldırıyor, pager
adapter'ını ayırıyor ve koşulları sağlandığında slayt callback'ini siliyor [E15].
Bu metotların varlığı her çıkış yolunun doğru temizlendiğini tek başına kanıtlamaz.

## 3. Mevcut Expo uygulamasına uygun şablon

Bu bölüm **tasarım önerisidir**, APK'nin birebir klasör yapısı değildir.
Mevcut alt sekmeleri korumak mümkün; yan menüye geçmek hata çözümü değildir.

```text
App shell
├─ Başlangıç / kilit durumu
├─ Navigation
│  ├─ Explore / Search / Favorites / Settings
│  ├─ Results(sessionId)
│  └─ Viewer(sessionId, postKey)
├─ Source registry
│  └─ Kaynak konfigürasyonu + desteklenen yetenekler
├─ Query sessions
│  └─ sourceSnapshot + query + paging + request generation + dispose
├─ Source adapters
│  └─ Kaynağa özgü URL / parse / detail / autocomplete
├─ Shared transport
│  └─ Timeout / gerçek iptal / retry / proxy / kaynak bazlı kuyruk
├─ Library storage
│  └─ Favorites / recent views / blacklist / preferences
└─ Media
   ├─ Image content
   ├─ Video content
   ├─ Playback ownership
   └─ UI overlays / gestures
```

Önerilen sorumluluk eşleştirmesi:

| Mevcut yer | Ayrılması gereken sorumluluk |
| --- | --- |
| `src/services/booruApi.ts` | Kaynak adapter'ları, transport ve sorgu oturumları |
| `src/screens/FeedScreen.tsx` ve arama ekranları | Ortak sayfalama/istek oturumu; ekran yalnızca sunum |
| `src/components/ImageViewerModal.tsx` | Viewer kabuğu, resim, video, galeri ve gesture bileşenleri |
| `src/services/storage.ts` | İçerik anahtarı, sıralı yazma ve depolama hata sonucu |
| `src/navigation/postsCache.ts` | Açık ekranların sahip olduğu oturum kayıtları |

### Temel veri sözleşmeleri

- **PostKey:** `sourceId + remotePostId`; tek başına uzak ID yeterli değil.
- **SourceSnapshot:** Kaynak kimliği ve isteğe gereken konfigürasyon;
  global seçimin sonradan değişmesinden etkilenmemeli.
- **Query:** Etiketler, sıralama, filtreler ve başlangıç sayfası.
- **PageResult:** İçerikler + sonraki sayfa/cursor + bitiş bilgisi.
- **QuerySession:** Sabit kaynak/sorgu, liste, sayfa, durum, istek nesli ve iptal.
- **MediaDescriptor:** Resim/video/galeri türü, URL'ler ve gerekli başlıklar;
  resim URL'si video oynatıcıya ulaşmamalı.
- **PlaybackOwner:** Ekran odakta, uygulama aktif, kilit kapalı ve içerik görünürse
  oynatma izni. Slayt, önizleme ve detay oynatıcısı aynı politikayı izlemeli.

## 4. Repodaki öncelikli sorunlar

Aşağıdakiler mevcut çalışma ağacının okunmasına dayanır. Cihazda donmanın kök
nedeni kanıtlanmış değildir. Kullanıcının mevcut değişiklikleri geri alınmadı.

### P1 — Kaynaklar arasında favori ID çakışması

- `booruApi.ts` örneğin 800–801, 880–881 ve 949–950 civarında `id` ve `sourceId`
  alanlarını ayrı üretiyor.
- `storage.ts:115–135`, favori sorgulama/silmeyi yalnızca `p.id` ile yapıyor.
- `FeedScreen.tsx:123–125` favori kümesini yalnızca ID ile kuruyor.
- Sonuç: İki farklı kaynaktaki aynı sayısal ID aynı favoriymiş gibi davranabilir.
- Öneri: Bütün favori, geçmiş, seçim ve karma liste anahtarlarında birleşik PostKey.
  Mevcut favoriler için kayıpsız migration gerekir.
- Test: A ve B kaynaklarının `42` ID'li iki gönderisini ekle; birini kaldırınca
  diğerinin korunması ve rozetlerin bağımsız olması gerekir.

### P1 — Eşzamanlı favori yazmaları birbirini ezebilir

- `storage.ts:124–135`: oku → değiştir → tüm diziyi yaz akışı var; yazma kuyruğu yok.
- İki eşzamanlı toggle aynı eski diziyi okursa son yazma diğer değişikliği kaybeder.
- Öneri: Yazmaları tek kuyrukta seri hale getir; UI'ya depolama hatasını açık ilet.
- Test: Kontrollü gecikmeli depolamayla paralel iki farklı favori ekle; ikisi de kalmalı.

### P1 — Gesture callback kimliği her render'da değişiyor

- `ViewerScreen.tsx:71–80` kapanış/etiket callback'lerini inline oluşturuyor.
- `ImageViewerModal.tsx:249–284`, `PanResponder` nesnesini `onClose` bağımlılığıyla
  memoize ediyor. Dolayısıyla parent render'ında responder yeniden oluşturulabilir.
- Eski `docs/freeze-diagnostic-report.md:52` bunun daha önce ele alındığını söylüyor;
  mevcut kod aynı stabilizasyonu taşımıyor. Rapor ile kod arasında fark var.
- Öneri: Callback kimliklerini sabitle, gesture sırasında render testini ekle.
- Bu, dokunmatik donmasının kanıtlanmış nedeni değildir.

### P1 — Slayt zamanlayıcısı suspend politikasını izlemiyor

- `ImageViewerModal.tsx:210–225`, interval'i yalnızca `isPlayingSlideshow` ile açıyor.
- `suspended` ve `visible` zamanlayıcı koşuluna dahil değil. Viewer başka route'un
  altında veya kilit arkasında mounted kalırsa slayt ilerleyebilir.
- Öneri: Görünürlük/odak/foreground/kilit koşulları değişince interval'i kaldır.
- Test: Slaytı başlat → etiket aramasına geç veya uygulamayı arka plana al → index
  ve timer sayısı sabit kalmalı; dönüş davranışı açıkça belirlenmeli.

### P2 — Kilit davranışı önceki raporla uyuşmuyor

- Eski rapor `inactive` durumunda kilitlemenin kaldırıldığını söylüyor.
- `App.tsx:167–172` hâlâ `background || inactive` durumunda kilit koyuyor.
- Öneri: Biyometri ve sistem diyaloglarıyla gerçek cihazda kilit geçişini test et;
  güvenlik beklentisini belirlemeden otomatik kilidi zayıflatma.
- Görünmez overlay veya sistem diyaloğu takılması bu incelemede gözlenmedi.

### P2 — Ortak API nesnesi ve rate-limit kilidi

- `booruApi.ts:178–206`: `currentSource` ve `lastRequestAt` ortak değişkenler.
- `fetchPosts()` başlangıçta kaynak snapshot'ı alıyor; bu nedenle tüm isteklerin
  yanlış kaynağa gittiğini söylemek doğru olmaz.
- Fakat ekranlar farklı sorgularla aynı servisi kullanıyor. Aynı anda bekleyen
  çağrılar aynı bekleme süresinden sonra birlikte devam edebilir; zaman damgası
  gerçek bir mutex/kuyruk değil.
- `FeedScreen` eski cevabın listeyi ezmesine karşı request nesli kontrolü içeriyor;
  bunu kaldırma. Bu kontrol tek başına ağ isteğini iptal etmez.
- Öneri: Explicit source taşıyan oturumlar, kaynak başına kuyruk, timeout ile
  iptal ayrımı ve sonlanmış oturuma geç cevap yazılmaması için testler.

## 5. Düzeltme sırası

1. Birleşik içerik anahtarını ve depolama yazma kuyruğunu testlerle ekle.
2. Viewer callback'lerini sabitle; slayt zamanlayıcısını suspend politikasına bağla.
3. Kilit/Modal/gesture senaryolarını gerçek cihazda ayrı ayrı ölç.
4. Tek bir kaynakla başlayarak API adapter + QuerySession ayrımını yap.
5. Diğer kaynakları kademeli taşı; tek seferde bütün uygulamayı yeniden yazma.
6. En son Home grupları, koleksiyonlar ve indirme yönetimi gibi yeni özellikleri düşün.

## 6. Doğrulama ve açık kalanlar

- `npm run test:freeze`: **104/104 geçti**.
- Yerel TypeScript `tsc --noEmit`: **geçti**.
- Bunlar native iOS/Android dokunmatik, gerçek ağ, sistem kilidi veya uzun süreli
  kullanım testleri değildir; donmanın giderildiğini kanıtlamaz.
- REA sınıf araması bu APK'de yinelenen/farklı sayıda sınıf envanteri hatası verdi.
  Başarısız sonucun kısmi adları yalnızca aday seçmek için kullanıldı; burada
  dayanak gösterilen sınıflar ve metotlar ayrı başarılı çağrılarla incelendi.
  Tam sınıf arama kapsamı iddia edilmiyor; REA sürümü yükseltilmedi.
- Piksel düzeyinde UI şablonu ve ekran görüntüleri: **açık**.
- Manifest, ana menü, kaynak oturumları ve seçili medya temizleme metotları:
  **yanıtlandı**.
- Bütün parser'lar, tüm ayarlar, favori DB sorguları ve indirme kuyruğu:
  **bu geçişte incelenmedi**.
- Mevcut uygulamadaki gerçek donmanın kök nedeni ve native stack:
  **açık**.

## 7. REA kanıt dizini

Tam oturum çıktısı yerel olarak
`C:\Users\PC\AppData\Local\Temp\opencode\droidbooru-2.1.0-rea-evidence.json`
dosyasına aktarılır. Manifest, decompiler metinleri ve kapsam sınırlamaları burada
tutulur. Aşağıdaki kimlikler bu incelemenin REA Evidence kayıtlarıdır.

| Etiket | İşlem / konu | Evidence ID |
| --- | --- | --- |
| E1 | APK manifest/paket | `ev_9f60731b47135cfd1499c1b72796f1a1bb2fe354ef59e9058e874371a18e9cab` |
| E2 | createDefaultFragment | `ev_17a0a3e12574f8b19da4bb1349dd2f5b0506d7e5a5e0c210a6deb69d4b60f7a7` |
| E3 | buildMainMenu | `ev_46d37b9b343a82c0fabe52994a969722d7308624b059038251a9d627a29a10fd` |
| E4 | onDrawerItemClick | `ev_cb8dc6ffbb8d1fd35fab3b5b7b69335a4f1c59fbde550c6456ec2a9146a72513` |
| E5 | HomeFragment üyeleri | `ev_5515e01da0be69e26c18dff93ba166a5783b3b39df11c8f65c2946f3c1e4430f` |
| E6 | SourceFactory.createSource #2 | `ev_6847255fc07c7c7ec2263fac33d33f304055108545e7dfae675efdfdf3f2a72f` |
| E7 | Source üyeleri | `ev_59b862dab23ce499e922f584822493d70be836cced5bcc28a17649af7f80804e` |
| E8 | SourceQuery üyeleri | `ev_51e1922eae2619c5b8ba252c1918df927b36e6d13f13718b21d1b81e2b9aff62` |
| E9 | removeAllSources | `ev_76e080d7df8d0364ecc7eaf6b842d2099bdab50c57174f5e1ba17895f6572435` |
| E10 | cancelCurrentConnection | `ev_53645d6f6e2af31e180eef57b3d20eac372885b5ef206e03828b76d731653735` |
| E11 | PageView.cleanup | `ev_5009b287eba6e02493dce05893dc387dbec353b392d44d4014d07cedca8eafc3` |
| E12 | PageView.recycleContentView | `ev_5a767747d400f2e378845ef13b86955cb642313dd49be8e95cece69fee9a1f67` |
| E13 | PageView.destroy | `ev_fa7046b2bc44ec875c2d5bc2d2b75e621d9733690d41ecfe008133cecea27297` |
| E14 | PageView.setVideoURL | `ev_eff5db54ef16f7df88c02179b2bded176c424b22a93d02e67eea8112fb657b1b` |
| E15 | DetailFragment.onDestroy | `ev_8e3d7fcdf9b0001f3379abce56a81f53488e64b09be210da8b6bd8b597281105` |

## 8. Yapılandırma notu

Yalnızca global OpenCode REA sunucusuna `REA_JADX_MCP_JAR` ve `JAVA_HOME` eklendi.
JAR resmî sürüm bağlantısından indirildi ve REA'nın sabit SHA-256 değeriyle doğrulandı:
`6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75`.

- JAR: `C:\Users\PC\.local\share\rea\android\jadx-headless-mcp-0.7.1-all.jar`
- Config: `C:\Users\PC\.config\opencode\opencode.jsonc`
- Yedek: `C:\Users\PC\.config\opencode\opencode.jsonc.jadx-20261016-131159.bak`
- Yapılandırma sonrası mevcut MCP oturumundaki paket analizi başarılı oldu [E1].
- Repo talimatı gereği Expo SDK 57'nin sürümlü referansı okundu:
  <https://docs.expo.dev/versions/v57.0.0/>.
