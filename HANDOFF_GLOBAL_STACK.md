# Global Stack Handoff — 2026-09-16
Goal: Sahte stack (navHistory+underlay+Modal viewer) kalkacak, gerçek @react-navigation/native-stack gelecek. Geri kaydırma native olacak, içerik->arama->geri önce içeriğe dönecek. Keşfet/Arama/Favoriler hepsi aynı stack'i kullanacak.

## Durum: İSKELET HAZIR, BAĞLANTI YARIM — TSC TEMİZ
`npx tsc --noEmit` = TSC_DONE, hata yok.

### Tamamlanan
- App.tsx: NavigationContainer(ref=navigationRef)+RootStack(MainTabs/Viewer/SearchDetail)+SourceProvider bağlı. RootStack screenOptions headerShown:false, animation:slide_from_right, gestureEnabled:true. MainTabsView keep-alive View'lar + Bottom TabBar korunuyor.
- src/navigation/types.ts: RootStackParamList { MainTabs, Viewer{postsKey,initialIndex,originTags?,originFilter?}, SearchDetail{tags,baseFilter?} }
- src/navigation/rootNavigation.ts: navigationRef, pushViewer(posts,idx,originTags?,originFilter?), pushSearchDetail(tags,baseFilter?), goBack()
- src/navigation/postsCache.ts: setCachedPosts/getCachedPosts
- src/context/SourceContext.tsx: initialSource->activeSource sync + booruApi.setSource
- src/screens/ViewerScreen.tsx: getCachedPosts(postsKey), ImageViewerModal asScreen visible suspended={!isFocused} dismissOnTagPress={false}, onClose=navigation.goBack, onTagPress/add/exclude -> pushSearchDetail
- src/screens/SearchDetailScreen.tsx: SearchScreen initialTag=tags.join(' ') initialMode=replace initialFilter={...baseFilter,tags,jumpToPage:1} onBackPress=navigation.goBack
- src/components/ImageViewerModal.tsx: props asScreen/suspended/dismissOnTagPress eklendi. asScreen==true ise Modal atlanıyor, viewerBody direkt dönülüyor. translateX asScreen ise 0'da sabit. suspended ise slideshow durduruluyor. isStackScreen ise handleDismiss direkt onClose.

### Yarım / Yapılmadı — yeni oturum bunları yapacak
1. FeedScreen.tsx: hala `selectedPostIndex+local ImageViewerModal`. Yap: `handleCardPress` -> `pushViewer(posts,idx,[],undefined)`, local modal + state sil, `import {pushViewer}` ekle.
2. FavoritesScreen.tsx: aynı — `filteredFavorites` ile `pushViewer(filteredFavorites,idx,[],undefined)`, local modal sil.
3. SearchScreen.tsx: sahte stack duruyor — `navHistory/backPreview/viewerEnterAnim/navHistoryRef/underlay/edgePanResponder/leftEdgeGestureArea` + satır ~1546 local ImageViewerModal silinecek. Grid onPress -> `pushViewer(results,idx,filterConfig.tags,filterConfig)`. Viewer içi arama artık ViewerScreen üzerinden pushSearchDetail yapacak, executeSearch(tag,'replace',true,originIdx) çağrıları silinecek.
4. SearchScreen props destructure bug: `interface` içinde `initialFilter/onBackPress` var ama bileşen argümanlarında YOK. Ekle: `initialFilter,onBackPress`. SearchDetail boş açılıyor sebebi bu. Ayrıca onBackPress varsa header'da geri butonu göster.
5. ImageViewerModal asScreen temizliği: `edgePanResponder.panHandlers` View'ı asScreen ise render etme, translateX transform'u asScreen ise uygulama. PostInfoModal onSearchTag/onAdd/onExclude içinde `onClose(); setTimeout(onTagPress)` var — asScreen||!dismissOnTagPress ise onClose çağırma, direkt onTagPress çağır.
6. Doğrula: `grep -rn pushViewer src App.tsx` en az 3 çağrı olmalı, `grep navHistory|backPreview|viewerEnterAnim src/screens/SearchScreen.tsx` 0 olmalı, `npx tsc --noEmit` temiz.

## Dosya durumu
M App.tsx, package.json, package-lock.json, src/components/ImageViewerModal.tsx, src/screens/FavoritesScreen.tsx, src/screens/SearchScreen.tsx, src/services/backupService.ts
?? src/context/, src/navigation/, src/screens/ViewerScreen.tsx, src/screens/SearchDetailScreen.tsx

## Yeni oturum açılış komutu
pwd; git status --short; npx tsc --noEmit; grep -rn "pushViewer|ImageViewerModal" src/screens --include="*.tsx" | head -n 30
Dar 40-80 satır read_file tekrarı yapma — dedup block yiyor. Terminal sed/grep ile geniş tara, sonra patch.

## Pitfalls
- `skill_view expo-app-dev` loop warning yedi, tekrar çağırma.
- `read_file App.tsx:1-50 / types / rootNavigation / Viewer` dedup BLOCKED — terminal kullan.
- backupService.ts değişikliği bu işle ilgisiz, dokunma.
