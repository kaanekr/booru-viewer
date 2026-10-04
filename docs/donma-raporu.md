# Donma Sorunu — Teşhis Raporu

Tarih: 2026-09-29
Kapsam: "biraz gezdikten sonra içeriklere dokunma/etkileşim ölüyor, uygulama ancak kapatıp açınca düzeliyor"

---

## 1. Belirti (kullanıcı gözlemleri)

- Uygulama "çalışıyor gibi" ama hiçbir şeye tepki vermiyor.
- Kaydırınca içerik **biraz** ilerliyor (native momentum), dokunma çalışmıyor.
- Viewer'da video oynuyor, ancak oynatıcı çubuğu `00:00`'da kalıyor.
- Kurtulmak için uygulamayı kapatıp yeniden açmak gerekiyor.
- Cihazı sallayıp Reload, ya da Metro terminalinde `r` — **ikisi de işe yaramıyor**.
- `expo-video` uyarısı: `VideoPlayer.replace` iOS'ta varlığı **ana thread'de senkron** yüklüyor → "UI freezes".
- `AVFoundation -11828 "Cannot Open"`: bir **JPEG** (`…-medium.jpg`) video oynatıcısına veriliyor.

---

## 2. Ölçüm sonuçları (cihazda, geliştirme build'i)

| Ölçüm | Değer | Anlamı |
|---|---|---|
| `setInterval` gecikmesi (JS thread) | 0–20 ms, arada 440–2500 ms | JS thread büyük ölçüde sağlıklı, tamamen kilitli değil |
| `requestAnimationFrame` kare sayısı | ~96–120 / 2 sn (~50–60 fps) | UI/ana thread canlı |
| Kök `onStartShouldSetResponderCapture` | Donma sırasında **dokunuşlar geliyor** | Dokunuşlar React ağacına ulaşıyor, bridge çalışıyor |
| Aktif video oynatıcı sayısı | 0–4 (bütçe sonrası), tepe 26'ya kadar | Sızıntı yok |
| Mount'lu ağır kart sayısı | 18–54 (pencere sonrası) | Ağaç sınırlı |

**Sonuç:** Donma bir thread kilidi değil. JS ayakta, UI ayakta, dokunuşlar köke ulaşıyor — ama hiçbir `Pressability`/`onPress` tetiklenmiyor.

---

## 3. Kapsam dışı bırakılanlar (kanıtlanmış olarak elendi)

Bunlar tek tek devre dışı bırakılıp test edildi, donma **devam etti**:

- Izgara kart görselleri (`expo-image`) — kapatıldı, donma sürdü.
- Izgara video önizlemeleri (`expo-video`) — kapatıldı, donma sürdü.
- İçerik ekranı (Viewer) — kapatıldı, donma sürdü.
- Render penceresi / mount hız sınırlayıcı / oynatma bütçesi (hepsi kapalıyken).
- Kart sayısı sınırlaması (120 kart) — donma sürdü.
- Uygulama kilidi (`isLocked` logu hiç görünmedi).
- Bellek: grid görselleri disk cache'e alındı, tam çözünürlüklü decode 2× ekranla sınırlandı, viewer çıkışında bellek temizleniyor.

---

## 4. Uygulanan düzeltmeler (kalıcı olanlar)

| # | Değişiklik | Gerekçe |
|---|---|---|
| 1 | `ViewerScreen`: `onClose` ve etiket callback'leri `useCallback` ile sabitlendi | `ImageViewerModal` içindeki kenar/timeline `PanResponder`'ları `useMemo` ile bu referanslara bağlıydı; her render'da yeniden oluşuyorlardı. Ortadaki bir jest sırasında native handler'lar değişiyor, ScrollView'ın `endDrag`'ı yutuluyordu. |
| 2 | Uygulama kilidi artık yalnız `background` durumunda açılıyor | `inactive`, iOS'ta `Alert`, Kontrol Merkezi, bildirim ve uygulama değiştiricide de geliyor. `inactive`'da kilitlemek, uygulamanın kendi uyarı kutularıyla görünmez bir kilit katmanı açabiliyordu. |
| 3 | `PostInfoModal` RN `<Modal>` yerine ekran içi katman (wip dalında) | `visible=true` haliyle sökülen modal iOS'ta yerel pencereyi tutuyor, dokunuşları kalıcı yutuyordu. |
| 4 | `replace()` → `replaceAsync()`, oynatıcıya görsel URL girmesine kapı (`isVideoUrl`) | `replace` ana thread'i senkron blokluyor; JPEG oynatıcıya giriyordu. |
| 5 | XVideos `THUMBNUM` şablonu normalleştirme, kare döngüsü 900 ms + sadece dokununca | Şablon kapak URL'i 404 → kart başına 4 istek zinciri. |
| 6 | XHamster çift oynatıcı düzeltmesi | Kapak mp4 iken üstüne ikinci `CardVideoPreview` açılıyordu. |
| 7 | Grid oynatıcıları ekran odağını bırakınca duruyor | Arka plandaki grid içerik ekranı açıkken oynamaya devam ediyordu. |

> 3–7. maddeler `wip-perf` dalında (`941719b`) duruyor; `main` üzerinde 1 ve 2 var.

---

## 5. Kalan adaylar (JS ölçümü artık ayırt edemiyor)

Metot ölçümü tükendiği için sıradaki adaylar **cihaz/native tarafında**:

1. **Native sistem penceresi takılı kalmış.** `expo-local-authentication` biyometri prompt'u veya RN `Alert` kutusu açık kalırsa: altındaki app çalışır, dokunuşlar uygulamaya ulaşmaz, **JS reload bu pencereyi kapatmaz** — salla/`r` işe yaramaması bunu güçlü biçimde destekliyor. → Donma anında ekranda bir sistem diyaloğu var mıydı, kontrol edilmeli.
2. **`react-native-screens` / native-stack geçiş kilidi.** Push/pop art arda (`popToTop`, `goBack`, etiket push'ları) hızlı zincirlerde transition kuyruğu takılabiliyor. → `react-native-screens` loglarını cihaz konsolundan okumak.
3. **Ana thread yığını.** Cihaz konsolunda (Xcode → Devices and Simulators) donma anının **ana thread stack trace'i** kesin cevabı verir: yığının nerede beklediği modülü doğrudan gösterir.

---

## 6. Önerilen sonraki adımlar

1. **Metro yerine Xcode'dan çalıştır** (Expo Go yerine). Cihaz konsolunda donma anındaki ana thread stack'ini al. Bu tek başına kök nedeni verir.
2. **Release build ile dene** (`eas build --profile production` veya yerel release). Donma yalnız geliştirme build'inde oluyorsa, sorun debug araçlarında/inspector'dadır ve kullanıcıyı etkilemez.
3. Aday 1 için: geçici olarak `LockScreen`'deki otomatik biyometri tetiğini kapat (`useBiometrics` ayarını kapat) ve Alert kullanımını gözden geçir.
4. Aday 2 için: `RootStack` `animation` değerlerini `fade`/`none` ile dene; `enableFreeze`/`detachInactiveScreens` ayarlarını kontrol et.

---

## 7. Bu oturumda denenen ve **işe yaramayan** yaklaşımlar (tekrar etmeyelim)

- Oynatıcı sayısını sınırlamak (bütçe 4) — kanıtlanmadı, işe yaramadı.
- Görünürlük payını 700→0 yapmak; "sınırda oynatıcı sökme" yarışını histerezis ile çözmek — işe yaramadı (oynatıcı sayısını 14→26'ya çıkardı).
- Sanallaştırma yerine render penceresi + mount hız sınırlayıcı — işe yaramadı.
- Uzun loglarla ölçüm — loglar bridge'i tıkadığı için ölçümü bozdu, ayrıştırıldı.
- Dev bisect anahtarlarıyla 3 tur ikili arama — donma tüm kombinasyonlarda devam etti; aday havuzunu daraltamadı.

**Sonuç:** Sorun JS tarafında değil. Metro logları artık yeterli kanıt vermiyor; bir sonraki adım **cihaz konsolunda ana thread stack'i** almaktır.

---

## 8. Yeni oturum bulguları (29.09.2026 akşam, `fix/donma-temiz` dalı)

### 8.1. Reload kanalı ölüyor, soket yaşıyor (kanıtlı)
- Donma anında Metro'da `r` → `Reloading apps` yazıyor ama cihaz tepki vermiyor (10x basış = 10 satır, sıfır etki).
- Aynı anda `netstat`: `192.168.1.15` → 5x `ESTABLISHED` (8081). TCP açık, komut işlenmiyor.
- **Hüküm:** reload komutu Metro WS üzerinden gidiyor ve donma o kanalı da öldürüyor. `r`/salla ile diriltme mümkün değil; tek yol force-quit + yeniden açma.

### 8.2. Çift heartbeat ile ölüm ayrımı
- `src/utils/heartbeat.ts`: 3sn'de dosyaya `zaman+route+src+n`, ~30sn'de Metro'ya `[Heartbeat] canli`.
- Donmada **ikisi de sustu** (dosya + Metro), ama perf monitor **fps oynamaya devam etti**.
- **Hüküm:** thread'ler tam ölmüyor; JS olayı işlemeye yetişemiyor (livelock — doygunluk). Klasik deadlock değil.

### 8.3. Ölüm bağlamları (heartbeat kuyrukları)
- Ölüm 1: `route=Feed`, düzenli 3sn tick → ani kesinti.
- Ölüm 2: `route=Settings src=xvideos n=156`.
- Ölüm 3: `route=Feed src=redgifs n=48→72→144` (sayfa büyürken), arada **19sn boşluk + toparlanma**, sonra `src=xvideos n=48`'de ölüm.
- Örüntü: ölüm hep `n` büyürken; önce takılma-recovery, sonra tam kilit. Biriken yük (oyuncu/event fırtınası) profili.

### 8.4. Expo Go `.ips` crash logu (`Downloads/Expo Go-2026-09-29-001200.ips`)
- `EXC_BAD_ACCESS SIGSEGV`, fault thread `com.facebook.react.runtime.JavaScript`.
- Stack: `hermes::doGetByIdSlowPath` ← `expo::callFunction` ← `JavaScriptPromise.resolve` ← `RuntimeScheduler runEventLoop`. Ölü objeye Promise callback'i = use-after-free.
- Main thread sağlıklı (UITableView layout), expo-video frame'i yok. Bu crash, o geceki hang'den ayrı olay; ama unmount-sonrası async callback ailesini destekliyor.

### 8.5. Uygulanan düzeltmeler (`fix/donma-temiz`, commitli)
1. `PostCard.tsx:237,249,472` senkron `replace()` → `replaceAsync()` (v57 docs: iOS'ta UI thread senkron yüklüyor).
2. `isVideoUrl` guard: JPEG oynatıcıya girmiyor (`media.ts` export + grid kullanımı).
3. `useVideoPlayer` karttan sökülüp `VideoCoverView`'a taşındı: resim kartlarda **sıfır** native player (Android emülatörde `VideoPlayer.constructor` NPE'yi de bitirdi).
4. `CardVideoPreview` kotası: max 4 eşzamanlı önizleme (`previewBudget.ts`); fazlası statik kapak.
5. Ölümcül hata → slayt fallback + oturumluk host kara liste (`markVideoHostDead`): proxy 503 / TLS -1202 host'u bir daha denenmiyor.
6. XVideos CDN'leri (`thumb-cdn*`, `thumbs-gcore`, `mp4-cdn*`) TLS-kırılgan listesine eklendi (worker varsa baştan proxy).
7. Bilinen bedel: worker bu URL'lere `HTTP 503` dönüyor (deno worker xvideos mp4 çekemiyor) — worker tarafı ayrı iş.

### 8.6. Açık sorular
- Worker kayıtlı değilken tüm proxy korumaları dormant — direkt bacak bozuk sertifikaya çarpıyor.
- Kota+fallback sonrası donma **devam etti** ("yine dondu") → video fırtınası tek başına açıklamıyor; LockScreen/`inactive` kilidi + modal katmanı hâlâ aday.
- Sonraki deney: heartbeat `canli` + dosya ikilisiyle bir donma daha yakala, ölüm ekranını sabitle.
