import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, BackHandler, Easing, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Database, Download, EyeOff, HardDrive, Image as ImageIcon, KeyRound, Layers, Lock, Radio, Settings2, Shield, SlidersHorizontal, Smartphone, Trash2, Upload, X } from 'lucide-react-native';
import type { BooruSource } from '../types/booru';
import { useSource } from '../context/SourceContext';
import { SourceCatalog, SourceMark, sourcePresentation } from '../components/SourceCatalog';
import { PasscodeModal } from '../components/PasscodeModal';
import { SettingsButton, SettingsRow, SettingsSection, settingsStyles as ui } from './settings/SettingsUI';
import { useSettings } from './settings/useSettings';
import { CACHE_LIMIT_PRESETS_MB, MAX_CACHE_LIMIT_MB, MIN_CACHE_LIMIT_MB } from '../services/storage';
import { Colors } from '../theme/colors';

function formatCacheBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatLimitLabel(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

type Page = 'home' | 'sources' | 'source' | 'appearance' | 'privacy' | 'storage' | 'network' | 'about';
interface SettingsScreenProps {
  activeSource?: BooruSource;
  onSelectSource?: (source: BooruSource) => void | Promise<void>;
  route?: { params?: { section?: 'sources' | 'network' } };
  navigation?: { setParams: (params: { section: undefined }) => void };
}
const TITLES: Record<Page, string> = {
  home: 'Settings', sources: 'Sources', source: 'Source settings', appearance: 'Viewing',
  privacy: 'Privacy & safety', storage: 'Storage & backup', network: 'Connection', about: 'About',
};
const QUALITY = [
  { id: 'preview' as const, name: 'Quick preview', description: 'Sample images. Lower data usage.' },
  { id: 'auto' as const, name: 'Automatic', description: 'Sample first, original when you zoom.' },
  { id: 'full' as const, name: 'Original quality', description: 'Full-resolution images from the start.' },
];

const AnimatedView = Animated?.View ?? View;

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ activeSource: propSource, onSelectSource, route, navigation }) => {
  const context = useSource();
  const activeSource = propSource ?? context.activeSource;
  const settings = useSettings(onSelectSource ?? context.selectSource);
  const insets = useSafeAreaInsets();
  const [pages, setPages] = useState<Page[]>(['home']);
  const [configuringSource, setConfiguringSource] = useState<BooruSource>(activeSource);
  const page = pages[pages.length - 1];
  const open = useCallback((next: Page) => setPages((previous) => [...previous, next]), []);
  const back = useCallback(() => setPages((previous) => previous.length > 1 ? previous.slice(0, -1) : previous), []);

  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const slideAnim = useRef(Animated?.Value ? new Animated.Value(0) : null).current;
  const fadeAnim = useRef(Animated?.Value ? new Animated.Value(1) : null).current;
  const prevDepthRef = useRef(pages.length);

  const animatePageTransition = useCallback((direction: 'forward' | 'back') => {
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
    if (!Animated?.parallel || !Animated?.timing || !slideAnim || !fadeAnim) return;
    slideAnim.setValue(direction === 'forward' ? 32 : -32);
    fadeAnim.setValue(0.25);
    const easing = typeof Easing?.out === 'function' && Easing?.cubic ? Easing.out(Easing.cubic) : undefined;
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 210,
        ...(easing ? { easing } : {}),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 180,
        ...(easing ? { easing } : {}),
        useNativeDriver: true,
      }),
    ]).start();
  }, [slideAnim, fadeAnim]);

  useEffect(() => {
    const prevDepth = prevDepthRef.current;
    prevDepthRef.current = pages.length;
    if (pages.length > prevDepth) {
      animatePageTransition('forward');
    } else if (pages.length < prevDepth) {
      animatePageTransition('back');
    }
  }, [pages.length, animatePageTransition]);

  useEffect(() => {
    setConfiguringSource((current) =>
      page !== 'source' || current.id === activeSource.id ? activeSource : current
    );
  }, [activeSource, page]);

  const pageAnimatedStyle = useMemo(
    () => (slideAnim && fadeAnim ? { opacity: fadeAnim, transform: [{ translateX: slideAnim }] } : undefined),
    [slideAnim, fadeAnim]
  );

  useFocusEffect(useCallback(() => {
    if (route?.params?.section) {
      setPages(['home', route.params.section]);
      navigation?.setParams({ section: undefined });
    }
  }, [route?.params?.section, navigation]));
  useFocusEffect(useCallback(() => {
    if (page === 'home' || settings.passcodeModalVisible) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => listener.remove();
  }, [page, back, settings.passcodeModalVisible]));

  const configure = (source: BooruSource) => { setConfiguringSource(source); open('source'); };
  const icon = (Icon: typeof Layers, danger = false) => <Icon size={18} color={danger ? '#F28B94' : '#A0A7F5'} strokeWidth={1.7} />;
  const openWebsite = (url: string) => Linking.openURL(url).catch(() => Alert.alert('Could not open link', 'Please open the website in your browser.'));
  const networkSummary = settings.savedWorkerUrl ? (settings.proxyEnabled ? 'Relay enabled' : 'Direct + CDN fallback') : 'Direct connection';

  const renderHome = () => <>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose source" onPress={() => open('sources')} activeOpacity={0.75} style={styles.sourceHero}>
      <View style={styles.heroTop}><Text style={styles.eyebrow}>YOUR SOURCE</Text><View style={styles.selectedPill}><View style={styles.dot} /><Text style={styles.selectedPillText}>Selected</Text></View></View>
      <View style={styles.heroMain}><SourceMark source={activeSource} large />
        <View style={styles.flex}><Text style={styles.heroName}>{activeSource.name}</Text><Text style={styles.heroDetail}>{sourcePresentation(activeSource).kind} · {activeSource.baseUrl.replace(/^https?:\/\//, '')}</Text></View>
        <ChevronRight size={20} color="#9B9FC0" />
      </View>
      <View style={styles.heroBottom}><Layers size={13} color="#949AC4" /><Text style={styles.heroBottomText}>Browse & manage sources</Text><ArrowUpRight size={14} color="#949AC4" /></View>
    </TouchableOpacity>

    <SettingsSection title="Your experience">
      <SettingsRow icon={icon(ImageIcon)} title="Viewing" subtitle="Image quality & video previews" value={QUALITY.find((item) => item.id === settings.imageQuality)?.name} onPress={() => open('appearance')} />
      <SettingsRow icon={icon(Shield)} title="Privacy & safety" subtitle="App lock, biometrics & blocked tags" onPress={() => open('privacy')} last />
    </SettingsSection>
    <SettingsSection title="App & data">
      <SettingsRow icon={icon(Radio)} title="Connection" subtitle={networkSummary} onPress={() => open('network')} />
      <SettingsRow icon={icon(Database)} title="Storage & backup" subtitle="Cache, history & your library" onPress={() => open('storage')} />
      <SettingsRow icon={icon(Smartphone)} title="About" value="1.0.0" onPress={() => open('about')} last />
    </SettingsSection>
    <View style={styles.footer}><View style={styles.footerRule} /><Text style={styles.footerText}>BOORU VIEWER</Text><View style={styles.footerRule} /></View>
    <Text style={styles.footerNote}>Version 1.0.0</Text>
  </>;

  const renderSource = () => {
    const source = configuringSource;
    const authId = source.id === 'rule34' || source.id === 'gelbooru' ? source.id : null;
    const auth = authId === 'rule34' ? settings.rule34Auth : settings.gelbooruAuth;
    const setAuth = authId === 'rule34' ? settings.setRule34Auth : settings.setGelbooruAuth;
    const saved = authId ? settings.savedAuth[authId] : null;
    const isSaved = !!saved?.apiKey && auth.apiKey === saved.apiKey && auth.userId === saved.userId;
    const accountUrl = source.id === 'rule34' ? 'https://rule34.xxx/index.php?page=account&s=options' : 'https://gelbooru.com/index.php?page=account&s=options';
    return <>
      <View style={styles.detailHero}><SourceMark source={source} large /><Text style={styles.detailName}>{source.name}</Text>
        <Text style={styles.detailMeta}>{sourcePresentation(source).kind} source</Text>
        <Text style={styles.detailDescription}>{source.description}</Text>
        {activeSource.id === source.id ? <View style={styles.currentLabel}><Check size={14} color="#A6ACFF" /><Text style={styles.currentLabelText}>Your current source</Text></View>
          : <SettingsButton title={`Use ${source.name}`} busy={settings.busy === 'source'} onPress={() => settings.changeSource(source)} />}
      </View>
      {authId && <SettingsSection title="Account & API" hint="Keys are saved on this device. Each source needs its own key. Refresh your feed after saving.">
        <View style={ui.form}>
          <View style={styles.authHeading}><KeyRound size={18} color="#A0A7F5" /><Text style={styles.formTitle}>{source.id === 'rule34' ? 'API key required' : 'Connect your account'}</Text></View>
          <Text style={ui.hint}>{source.id === 'rule34' ? 'Rule34 requires your user ID and API key to load posts.' : 'A Gelbooru API key enables DAPI access and higher request limits.'}</Text>
          <TouchableOpacity accessibilityRole="link" onPress={() => openWebsite(accountUrl)} style={styles.link}><Text style={styles.linkText}>Get your API key</Text><ArrowUpRight size={14} color="#A6ACFF" /></TouchableOpacity>
          <View><Text style={ui.label}>User ID</Text><TextInput accessibilityLabel={`${source.name} user ID`} placeholder={`${source.id === 'rule34' ? 'Rule34' : 'Gelbooru'} user_id`}
            placeholderTextColor={Colors.dark.textMuted} value={auth.userId} onChangeText={(userId) => setAuth((previous) => ({ ...previous, userId }))}
            keyboardType="numeric" autoCapitalize="none" autoCorrect={false} style={ui.input} /></View>
          <View><Text style={ui.label}>API key</Text><TextInput accessibilityLabel={`${source.name} API key`} placeholder={`${source.id === 'rule34' ? 'Rule34' : 'Gelbooru'} api_key`}
            placeholderTextColor={Colors.dark.textMuted} value={auth.apiKey} onChangeText={(apiKey) => setAuth((previous) => ({ ...previous, apiKey }))}
            autoCapitalize="none" autoCorrect={false} secureTextEntry style={ui.input} /></View>
          <View style={ui.actions}><SettingsButton title="Save" busy={settings.busy === 'auth'} disabled={!!settings.busy} onPress={() => settings.saveAuth(authId)} />
            {(auth.apiKey || auth.userId || saved?.apiKey) ? <SettingsButton title="Delete Key" secondary danger disabled={!!settings.busy} onPress={() => settings.clearAuth(authId)} /> : null}
          </View>
          {isSaved && <Text accessibilityLiveRegion="polite" style={ui.status}>Saved — {source.id === 'rule34' ? 'Rule34' : 'Gelbooru'} requests use your key</Text>}
        </View>
      </SettingsSection>}
      <SettingsSection title="Source details">
        <SettingsRow title="Website" subtitle={source.baseUrl.replace(/^https?:\/\//, '')} onPress={() => openWebsite(source.id === 'rule34' ? 'https://rule34.xxx' : source.baseUrl)} />
        <SettingsRow title="Connection settings" subtitle="App-wide relay & connection diagnostics" icon={icon(Radio)} onPress={() => open('network')} last />
      </SettingsSection>
      {!authId && <View style={ui.note}><Text style={ui.hint}>No manual API key is needed for this source. Connection preferences apply across all sources.</Text></View>}
    </>;
  };

  const renderAppearance = () => <>
    <Text style={styles.pageIntro}>Image quality and motion preferences.</Text>
    <SettingsSection title="Image quality" hint="Applies to images in the viewer. Original files can use considerably more data.">
      {QUALITY.map((item, index) => <TouchableOpacity key={item.id} accessibilityRole="radio" accessibilityLabel={item.name}
        accessibilityState={{ selected: settings.imageQuality === item.id, disabled: !!settings.busy }} disabled={!!settings.busy}
        onPress={() => settings.changeQuality(item.id)} style={[styles.qualityRow, index < QUALITY.length - 1 && styles.divider]}>
        <View style={styles.flex}><View style={styles.inline}><Text style={styles.formTitle}>{item.name}</Text>{item.id === 'auto' && <Text style={styles.recommended}>RECOMMENDED</Text>}</View><Text style={styles.rowDescription}>{item.description}</Text></View>
        <View style={[styles.radio, settings.imageQuality === item.id && styles.radioSelected]}>{settings.imageQuality === item.id && <Check size={12} color="#FFF" />}</View>
      </TouchableOpacity>)}
    </SettingsSection>
    <SettingsSection title="Motion" hint="Turn off previews for quieter browsing, less data usage and fewer active video players.">
      <SettingsRow icon={icon(ImageIcon)} title="Video previews" subtitle={settings.gridPreviews ? 'Play previews on visible cards' : 'Show static covers only'} toggle={settings.gridPreviews} onToggle={settings.togglePreviews} busy={settings.busy === 'previews'} last />
    </SettingsSection>
  </>;

  const renderPrivacy = () => <>
    <Text style={styles.pageIntro}>Control access to the app and what appears in your feed.</Text>
    <SettingsSection title="App lock" hint="A four-digit PIN protects the app when you open it or return from the background.">
      <SettingsRow icon={icon(Lock)} title="Passcode lock" subtitle={settings.passcodeEnabled ? 'PIN protection enabled' : 'Not enabled'} toggle={settings.passcodeEnabled}
        onToggle={(enabled) => settings.openPasscode(enabled ? 'setup' : 'disable')} last={!settings.passcodeEnabled} />
      {settings.passcodeEnabled && <>
        {settings.hasBiometrics && <SettingsRow title={`Unlock with ${settings.biometryType || 'biometrics'}`} subtitle="Your PIN remains available as a fallback" toggle={settings.useBiometrics} onToggle={settings.toggleBiometrics} busy={settings.busy === 'biometrics'} />}
        <SettingsRow title="Change passcode" onPress={() => settings.openPasscode('change')} last />
      </>}
    </SettingsSection>
    <SettingsSection title={`Blocked tags · ${settings.blacklistedTags.length}`} hint="Posts containing these tags are hidden from feeds and search. Add tags from a post’s info panel.">
      {settings.blacklistedTags.length ? <>
        <View style={styles.tags}>{settings.blacklistedTags.map((tag) => <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Unblock ${tag}`} onPress={() => settings.removeTag(tag)} disabled={!!settings.busy} style={styles.removeTag}><X size={14} color="#C5C8D5" /></TouchableOpacity>
        </View>)}</View>
        <SettingsRow title="Clear blocked tags" danger icon={icon(Trash2, true)} onPress={settings.clearTags} last />
      </> : <View style={styles.empty}><EyeOff size={24} color={Colors.dark.textMuted} /><Text style={styles.emptyTitle}>Nothing blocked</Text><Text style={ui.hint}>Your blocked tags will appear here.</Text></View>}
    </SettingsSection>
  </>;

  const renderStorage = () => {
    const videoBudgetMb = Math.max(50, Math.round(settings.cacheLimitMb * 0.6));
    const listBudgetMb = Math.min(50, Math.max(8, Math.round(settings.cacheLimitMb * 0.1)));
    return <>
      <Text style={styles.pageIntro}>Back up your library and manage local cache limits.</Text>
      <SettingsSection title="Cache limit" hint={`Controls how much disk space local video and list caches can use (${MIN_CACHE_LIMIT_MB}–${MAX_CACHE_LIMIT_MB} MB). Lowering the limit frees older files immediately.`}>
        <View style={styles.cachePresetRow}>
          {CACHE_LIMIT_PRESETS_MB.map((mb) => {
            const selected = settings.cacheLimitMb === mb;
            return (
              <TouchableOpacity
                key={mb}
                accessibilityRole="radio"
                accessibilityLabel={`Cache limit ${formatLimitLabel(mb)}`}
                accessibilityState={{ selected, disabled: !!settings.busy }}
                disabled={!!settings.busy}
                onPress={() => settings.changeCacheLimit(mb)}
                style={[styles.cachePresetChip, selected && styles.cachePresetChipActive]}
              >
                <Text style={[styles.cachePresetText, selected && styles.cachePresetTextActive]}>
                  {formatLimitLabel(mb)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={ui.form}>
          <View>
            <Text style={ui.label}>Custom limit (MB)</Text>
            <TextInput
              accessibilityLabel="Custom cache size MB"
              placeholder={`${MIN_CACHE_LIMIT_MB}–${MAX_CACHE_LIMIT_MB}`}
              placeholderTextColor={Colors.dark.textMuted}
              value={settings.cacheLimitInput}
              onChangeText={settings.setCacheLimitInput}
              keyboardType="number-pad"
              style={ui.input}
            />
          </View>
          <View style={ui.actions}>
            <SettingsButton
              title="Save limit"
              busy={settings.busy === 'cacheLimit'}
              disabled={!!settings.busy}
              onPress={settings.saveCustomCacheLimit}
            />
          </View>
          <Text style={ui.status}>
            Active limit: {formatLimitLabel(settings.cacheLimitMb)} (Video ~{videoBudgetMb} MB · Lists ~{listBudgetMb} MB)
          </Text>
        </View>
      </SettingsSection>
      <SettingsSection title="Cache storage" hint="Clear individual caches without affecting your favorites, API keys or preferences.">
        <SettingsRow title="Clear image cache" subtitle="Thumbnails & full-resolution viewer images" icon={icon(ImageIcon)} onPress={settings.clearImageCache} />
        <SettingsRow title="Clear video cache" subtitle={`${formatCacheBytes(settings.cacheStats.videoBytes)} · ${settings.cacheStats.videoFiles} cached videos`} icon={icon(HardDrive)} onPress={settings.clearVideoCache} />
        <SettingsRow title="Clear list & API cache" subtitle={`${formatCacheBytes(settings.cacheStats.listBytes)} · ${settings.cacheStats.listEntries} cached pages`} icon={icon(Database)} onPress={settings.clearApiCache} last />
      </SettingsSection>
      <SettingsSection title="Backup & transfer" hint="Supports AnimeBoxes (.abbj) and JSON files. Export your favorites and tags before moving to another device.">
        <SettingsRow title="Import backup" subtitle="Choose an .abbj or JSON file" icon={icon(Download)} onPress={settings.importBackup} busy={settings.busy === 'import'} />
        <SettingsRow title="Export library" subtitle="Save or share a JSON backup" icon={icon(Upload)} onPress={settings.exportBackup} busy={settings.busy === 'export'} last />
      </SettingsSection>
      <SettingsSection title="Free up space" hint="These actions do not delete your favorites, API keys or preferences.">
        <SettingsRow title="Clear media cache" subtitle="Clear all image, video & list caches at once" icon={icon(HardDrive)} onPress={settings.clearCache} />
        <SettingsRow title="Clear search history" subtitle="Remove searches saved on this device" icon={icon(Trash2, true)} onPress={settings.clearHistory} danger last />
      </SettingsSection>
    </>;
  };

  const renderNetwork = () => <>
    <Text style={styles.pageIntro}>Choose how you connect.</Text>
    <View style={styles.connectionBanner}><Radio size={22} color="#A0A7F5" /><View style={styles.flex}><Text style={styles.formTitle}>{networkSummary}</Text><Text style={styles.rowDescription}>Applies to all sources</Text></View></View>
    <SettingsSection title="Cloudflare relay" hint="With the relay off, a saved Worker is still used for TLS-fragile CDNs and request fallbacks. Remove it to use direct connections only.">
      <SettingsRow title="Route all traffic via Worker" subtitle={settings.proxyEnabled ? 'Relay enabled for all requests' : 'Direct first, with registered Worker fallback'} toggle={settings.proxyEnabled} onToggle={settings.toggleProxy} busy={settings.busy === 'proxy'} />
      <View style={ui.form}><View><Text style={ui.label}>Worker URL</Text><TextInput accessibilityLabel="Worker URL" placeholder="https://your-worker.workers.dev" value={settings.workerUrl}
        onChangeText={settings.setWorkerUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholderTextColor={Colors.dark.textMuted} style={ui.input} /></View>
        <View style={ui.actions}><SettingsButton title="Save URL" onPress={settings.saveWorker} busy={settings.busy === 'worker'} disabled={!!settings.busy || settings.isTestingProxy} />
          {!!settings.savedWorkerUrl && <SettingsButton title="Remove Worker" secondary danger onPress={settings.removeWorker} disabled={!!settings.busy || settings.isTestingProxy} />}
        </View>
        {!!settings.savedWorkerUrl && settings.workerUrl === settings.savedWorkerUrl && <Text style={ui.status}>Worker URL saved on this device</Text>}
      </View>
    </SettingsSection>
    <SettingsSection title="Diagnostics" hint="Compares direct and relay access. HTTP codes show reachability, not successful authentication. Tests do not send your API keys.">
      <View style={ui.form}><Text style={ui.hint}>Check which sources can be reached on your current connection.</Text>
        <SettingsButton title="Test connection" secondary onPress={settings.testConnection} busy={settings.isTestingProxy} disabled={!settings.savedWorkerUrl || !!settings.busy} />
      </View>
      {!!settings.connectionResults.length && <View style={styles.results}>
        <View style={styles.resultRow}><Text style={[styles.resultName, styles.eyebrow]}>SOURCE</Text><Text style={styles.resultHeader}>DIRECT</Text><Text style={styles.resultHeader}>RELAY</Text></View>
        {settings.connectionResults.map((result) => <View key={result.name} style={styles.resultRow}><Text style={styles.resultName}>{result.name}</Text><Text style={styles.resultValue}>{result.direct}</Text><Text style={styles.resultValue}>{result.relay}</Text></View>)}
      </View>}
    </SettingsSection>
  </>;

  return <KeyboardAvoidingView style={[styles.container, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}>
      {page !== 'home' && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to settings" onPress={back} style={styles.back}><ArrowLeft size={21} color="#E9EBF4" /></TouchableOpacity>}
      <View style={styles.flex}><Text style={page === 'home' ? styles.title : styles.subpageTitle}>{page === 'source' ? configuringSource.name : TITLES[page]}</Text>
        <Text style={styles.headerSubtitle}>{page === 'home' ? 'Sources, viewing & privacy' : page === 'sources' ? 'Choose where you browse.' : 'SETTINGS'}</Text>
      </View>
      {page === 'home' && <View style={styles.headerIcon}><SlidersHorizontal size={20} color="#9298CA" /></View>}
    </View>
    {settings.loading ? <View style={styles.empty}><ActivityIndicator color={Colors.dark.primaryLight} /></View> : <ScrollView ref={scrollRef} style={styles.scroll} showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
      <AnimatedView style={pageAnimatedStyle}>
        {page === 'home' && renderHome()}
        {page === 'sources' && <>
          <View style={styles.catalogNotice}><Settings2 size={15} color={Colors.dark.textSecondary} /><Text style={styles.rowDescription}>Switch with a tap. Use the settings icon for account & API options.</Text></View>
          <SourceCatalog activeSource={activeSource} onSelect={settings.changeSource} onConfigure={configure} busy={settings.busy === 'source'}
            credentials={{ rule34: !!settings.savedAuth.rule34.apiKey && !!settings.savedAuth.rule34.userId }} />
        </>}
        {page === 'source' && renderSource()}
        {page === 'appearance' && renderAppearance()}
        {page === 'privacy' && renderPrivacy()}
        {page === 'storage' && renderStorage()}
        {page === 'network' && renderNetwork()}
        {page === 'about' && <><View style={styles.detailHero}><View style={styles.appMark}><Layers size={32} color="#B1B5FF" strokeWidth={1.3} /></View>
          <Text style={styles.detailName}>Booru Viewer</Text><Text style={styles.detailMeta}>Your library. Your way.</Text></View>
          <SettingsSection title="Application"><SettingsRow title="Version" value="1.0.0" /><SettingsRow title="Platform" value="React Native · Expo 58" /><SettingsRow title="Connection" value={networkSummary} last /></SettingsSection>
          <Text style={ui.hint}>An independent multi-source viewer. Not affiliated with any content source. Adults only (18+).</Text></>}
      </AnimatedView>
    </ScrollView>}
    <PasscodeModal visible={settings.passcodeModalVisible} mode={settings.passcodeModalMode} onClose={settings.closePasscode} onSuccess={settings.refreshSecurity} />
  </KeyboardAvoidingView>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 22, paddingTop: 16, paddingBottom: 20 },
  title: { fontSize: 32, fontWeight: '700', color: '#F2F3FA', letterSpacing: -1.1 },
  subpageTitle: { fontSize: 23, fontWeight: '600', color: '#F2F3FA', letterSpacing: -0.6 },
  headerSubtitle: { fontSize: 11, color: '#8B90A7', marginTop: 5, letterSpacing: 0.3 },
  headerIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#1B1F31', alignItems: 'center', justifyContent: 'center' },
  back: { width: 40, height: 44, justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, maxWidth: 680, width: '100%', alignSelf: 'center' },
  pageIntro: { color: '#A1A6BB', fontSize: 14, lineHeight: 21, marginBottom: 26, marginTop: 4 },
  sourceHero: { backgroundColor: '#171B2C', borderWidth: 1, borderColor: '#343953', borderRadius: 22, padding: 18, marginBottom: 30 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  eyebrow: { fontSize: 9, letterSpacing: 1.6, fontWeight: '700', color: '#9B9FBA' },
  selectedPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#818CF80C', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 5 },
  selectedPillText: { color: '#AFB4E3', fontSize: 10, fontWeight: '500' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#A6ACFF' },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroName: { color: '#F2F3FA', fontSize: 23, fontWeight: '600', letterSpacing: -0.5 },
  heroDetail: { color: '#959AB4', fontSize: 11, lineHeight: 17, marginTop: 5 },
  heroBottom: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 16, marginTop: 20, borderTopWidth: 1, borderTopColor: '#FFFFFF09' },
  heroBottomText: { color: '#949AC4', fontSize: 11, flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 14, justifyContent: 'center', marginTop: 12, paddingHorizontal: 46 },
  footerRule: { flex: 1, height: 1, backgroundColor: '#242839' },
  footerText: { color: '#656B86', fontSize: 8, fontWeight: '700', letterSpacing: 2.4 },
  footerNote: { textAlign: 'center', color: '#666C82', fontSize: 10, marginTop: 10, marginBottom: 10 },
  catalogNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 },
  detailHero: { alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 30 },
  detailName: { color: '#F2F3FA', fontSize: 26, fontWeight: '600', letterSpacing: -0.6, marginTop: 6 },
  detailMeta: { color: '#969BB3', fontSize: 12 },
  detailDescription: { color: '#9CA1B8', fontSize: 12, lineHeight: 20, textAlign: 'center', maxWidth: 300, marginVertical: 4 },
  currentLabel: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 8 },
  currentLabelText: { color: '#A6ACFF', fontSize: 12 },
  authHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  formTitle: { color: '#E5E7F0', fontSize: 14, fontWeight: '600' },
  link: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, minHeight: 36 },
  linkText: { color: '#A6ACFF', fontSize: 12, fontWeight: '500' },
  qualityRow: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 12, minHeight: 82 },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.dark.divider },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  recommended: { color: '#A5ABEA', fontSize: 8, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: 5, paddingVertical: 3, backgroundColor: '#818CF812', borderRadius: 4 },
  rowDescription: { color: '#959BB2', fontSize: 11, lineHeight: 18, flexShrink: 1, marginTop: 4 },
  radio: { width: 21, height: 21, borderRadius: 11, borderWidth: 1.5, borderColor: '#363C52', justifyContent: 'center', alignItems: 'center' },
  radioSelected: { borderColor: Colors.dark.primary, backgroundColor: Colors.dark.primary },
  empty: { padding: 30, alignItems: 'center', gap: 12 },
  emptyTitle: { color: '#D9DCE9', fontSize: 14, fontWeight: '500' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 },
  tag: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#252A3C', borderRadius: 9, paddingLeft: 10, maxWidth: '100%' },
  tagText: { color: '#D2D6E7', fontSize: 12, flexShrink: 1 },
  removeTag: { minWidth: 36, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  connectionBanner: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#818CF80B', padding: 18, borderRadius: 16, marginBottom: 26 },
  results: { paddingHorizontal: 16, paddingBottom: 12 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 5, borderTopWidth: 1, borderTopColor: Colors.dark.divider, paddingVertical: 12 },
  resultName: { color: '#C2C6D9', flex: 1, fontSize: 10 },
  resultValue: { color: '#999FB8', flex: 1, fontSize: 10, textAlign: 'right' },
  resultHeader: { color: '#747B96', flex: 1, fontSize: 8, fontWeight: '700', letterSpacing: 0.7, textAlign: 'right' },
  appMark: { width: 76, height: 76, borderRadius: 24, backgroundColor: '#1B1E39', alignItems: 'center', justifyContent: 'center' },
  cachePresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 16 },
  cachePresetChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1E2233', borderWidth: 1, borderColor: '#2E344B' },
  cachePresetChipActive: { backgroundColor: '#6366F128', borderColor: Colors.dark.primary },
  cachePresetText: { color: '#B4B9CE', fontSize: 12, fontWeight: '600' },
  cachePresetTextActive: { color: '#E8EAFF' },
});
