import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ShieldCheck,
  Shield,
  Lock,
  KeyRound,
  ScanFace,
  Fingerprint,
  ChevronRight,
  Layers,
  Trash2,
  Check,
  Smartphone,
  Globe,
  Radio,
  Zap,
  FolderDown,
  FolderUp,
  HardDrive,
  Share2,
  Image as ImageIcon,
  EyeOff,
  X,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { BooruSource } from '../types/booru';
import { AVAILABLE_SOURCES } from '../services/sources';
import { StorageService, ImageQuality } from '../services/storage';
import { proxyService } from '../services/proxyService';
import { PORNHUB_UA, PORNHUB_BASE, parsePornhubHtmlListing } from '../services/pornhub';
import { XVIDEOS_UA, XVIDEOS_BASE, parseXVideosListing } from '../services/xvideos';
import { XHAMSTER_UA, XHAMSTER_BASE, parseXhamsterListing } from '../services/xhamster';
import { BackupService } from '../services/backupService';
import { SecurityService, BiometryType } from '../services/securityService';
import { PasscodeModal, PasscodeModalMode } from '../components/PasscodeModal';
import { clearCachedPosts } from '../navigation/postsCache';
import { useSource } from '../context/SourceContext';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../theme/colors';

const GOLD_ACCENT = '#F5A623';

interface QualityOption {
  id: ImageQuality;
  title: string;
  desc: string;
}

const QUALITY_OPTIONS: QualityOption[] = [
  {
    id: 'preview',
    title: 'Hızlı Önizleme',
    desc: 'Sample çözünürlük, az veri kullanımı',
  },
  {
    id: 'auto',
    title: 'Otomatik (Önerilen)',
    desc: 'Normalde sample, zoom\'da tam çözünürlük',
  },
  {
    id: 'full',
    title: 'Tam Çözünürlük',
    desc: 'Her zaman original, çok veri kullanımı',
  },
];

interface SettingsScreenProps {
  activeSource?: BooruSource;
  onSelectSource?: (source: BooruSource) => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  activeSource: propSource,
  onSelectSource: propSelectSource,
}) => {
  const { activeSource: contextSource, selectSource } = useSource();
  const activeSource = propSource ?? contextSource;
  const onSelectSource = propSelectSource ?? selectSource;
  const insets = useSafeAreaInsets();
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [workerUrl, setWorkerUrl] = useState('');
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<string | null>(null);
  const [imageQuality, setImageQuality] = useState<ImageQuality>('auto');
  const [blacklistedTags, setBlacklistedTags] = useState<string[]>([]);
  const [gelbooruUserId, setGelbooruUserId] = useState('');
  const [gelbooruApiKey, setGelbooruApiKey] = useState('');
  const [gelbooruAuthSaved, setGelbooruAuthSaved] = useState(false);
  const [isBlacklistOpen, setIsBlacklistOpen] = useState(false);

  // Security & Passcode State
  const [passcodeEnabled, setPasscodeEnabled] = useState(false);
  const [useBiometrics, setUseBiometrics] = useState(true);
  const [biometryType, setBiometryType] = useState<BiometryType | null>(null);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [passcodeModalVisible, setPasscodeModalVisible] = useState(false);
  const [passcodeModalMode, setPasscodeModalMode] = useState<PasscodeModalMode>('setup');

  const refreshSecurityConfig = async () => {
    const config = await SecurityService.getConfig();
    const bioStatus = await SecurityService.getBiometricStatus();
    setPasscodeEnabled(config.enabled && !!config.passcodeHash);
    setUseBiometrics(config.useBiometrics);
    setBiometryType(bioStatus.biometryType);
    setHasBiometrics(bioStatus.hasHardware && bioStatus.isEnrolled);
  };

  useEffect(() => {
    StorageService.getProxyConfig().then((config) => {
      setProxyEnabled(config.enabled);
      setWorkerUrl(config.workerUrl);
      proxyService.setConfig(config.enabled, config.workerUrl);
    });
    StorageService.getImageQuality().then(setImageQuality);
    StorageService.getGelbooruAuth().then((auth) => {
      setGelbooruUserId(auth.userId || '');
      setGelbooruApiKey(auth.apiKey || '');
      setGelbooruAuthSaved(!!(auth.userId && auth.apiKey));
    });
    refreshSecurityConfig();
  }, []);

  // Kara liste içerikten de değişebildiği için (PostInfoModal) her odakta tazele
  useFocusEffect(
    useCallback(() => {
      StorageService.getBlacklistedTags().then(setBlacklistedTags);
    }, [])
  );

  const handleRemoveBlacklistedTag = async (tag: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await StorageService.removeBlacklistedTag(tag);
    setBlacklistedTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleClearAllBlacklistedTags = () => {
    Alert.alert(
      'Kara Listeyi Temizle',
      'Tüm engellenen etiketleri silmek istediğinizden emin misiniz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Temizle',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await StorageService.saveAllBlacklistedTags([]);
            setBlacklistedTags([]);
          },
        },
      ]
    );
  };

  const handleSourceChange = (source: BooruSource) => {
    Haptics.selectionAsync();
    onSelectSource(source);
  };

  const handleQualityChange = async (quality: ImageQuality) => {
    Haptics.selectionAsync();
    setImageQuality(quality);
    await StorageService.setImageQuality(quality);
  };

  const handleSaveGelbooruAuth = async () => {
    Haptics.selectionAsync();
    const userId = gelbooruUserId.trim();
    const apiKey = gelbooruApiKey.trim();
    await StorageService.setGelbooruAuth({ userId, apiKey });
    setGelbooruAuthSaved(!!(userId && apiKey));
  };

  const handleClearGelbooruAuth = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await StorageService.setGelbooruAuth({ userId: '', apiKey: '' });
    setGelbooruUserId('');
    setGelbooruApiKey('');
    setGelbooruAuthSaved(false);
  };

  const handleToggleProxy = async (val: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setProxyEnabled(val);
    proxyService.setConfig(val, workerUrl);
    await StorageService.setProxyConfig({ enabled: val, workerUrl });
    setProxyTestResult(null);
  };

  const handleSaveWorkerUrl = async (text: string) => {
    const cleaned = text.trim();
    setWorkerUrl(cleaned);
    proxyService.setConfig(proxyEnabled, cleaned);
    await StorageService.setProxyConfig({ enabled: proxyEnabled, workerUrl: cleaned });
  };

  const handleTestProxy = async () => {
    if (!workerUrl.trim()) {
      Alert.alert('Eksik Bilgi', 'Lütfen geçerli bir Cloudflare Worker URL adresi girin.');
      return;
    }

    setIsTestingProxy(true);
    setProxyTestResult(null);
    Haptics.selectionAsync();

    const cleanUrl = workerUrl.trim().replace(/\/$/, '');
    // Engel tanısı: her video hostuna direkt + worker üzerinden paralel
    // yoklama. HTTP kodu dönmesi = yol açık (401 bile ulaşılabilir demek);
    // 'kopuk'/'zaman aşımı' = TLS/SNI engeli. Kart sayısı = gövde gerçekten
    // parse edilebiliyor mu (worker içeriği bozuyorsa 200/0 çıkar).
    const stubSource = (id: string, baseUrl: string) => ({ id, name: id, baseUrl, type: id }) as any;
    const targets: {
      name: string;
      url: string;
      headers: Record<string, string>;
      parse?: (html: string) => number;
    }[] = [
      {
        name: 'PH',
        url: `${PORNHUB_BASE}/webmasters/search?search=test&page=1&thumbsize=medium`,
        headers: { 'User-Agent': PORNHUB_UA, Referer: `${PORNHUB_BASE}/`, Accept: 'application/json' },
      },
      {
        name: 'PHweb',
        url: `${PORNHUB_BASE}/video?o=mv&page=1`,
        headers: { 'User-Agent': PORNHUB_UA, Referer: `${PORNHUB_BASE}/`, Cookie: 'accessAgeDisclaimerPH=1; platform=pc' },
        parse: (html) => parsePornhubHtmlListing(html, stubSource('pornhub', PORNHUB_BASE)).length,
      },
      {
        name: 'XH',
        url: `${XHAMSTER_BASE}/newest/1`,
        headers: { 'User-Agent': XHAMSTER_UA, Referer: `${XHAMSTER_BASE}/`, Accept: 'text/html,application/xhtml+xml' },
        parse: (html) => parseXhamsterListing(html, stubSource('xhamster', XHAMSTER_BASE)).length,
      },
      {
        name: 'XV',
        url: `${XVIDEOS_BASE}/new/1`,
        headers: { 'User-Agent': XVIDEOS_UA, Referer: `${XVIDEOS_BASE}/`, Accept: 'text/html,application/xhtml+xml' },
        parse: (html) => parseXVideosListing(html, stubSource('xvideos', XVIDEOS_BASE)).length,
      },
      {
        name: 'RG',
        url: 'https://api.redgifs.com/v2/gifs/search?type=g&order=trending&count=1&page=1',
        headers: { 'User-Agent': PORNHUB_UA, Origin: 'https://www.redgifs.com', Referer: 'https://www.redgifs.com/', Accept: 'application/json' },
      },
    ];
    const probe = async (url: string, headers: Record<string, string>, parse?: (html: string) => number): Promise<string> => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const run = (async () => {
        try {
          const res = await fetch(url, { headers, signal: ctrl.signal });
          if (!res.ok || !parse) return String(res.status);
          const html = await res.text();
          let n = 0;
          try {
            n = parse(html);
          } catch {
            n = -1;
          }
          return `${res.status}/${n}`;
        } catch (e: any) {
          const msg = String(e?.message || e || '');
          return /abort|cancel/i.test(e?.name || '') || /abort/i.test(msg) ? 'zaman aşımı' : 'kopuk';
        } finally {
          clearTimeout(t);
        }
      })();
      // Release'de abort askıda kalabilir: test sonsuza dönmesin diye 12sn'de kes.
      let rt: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          run.then((v) => { if (rt) clearTimeout(rt); return v; }, (e) => { if (rt) clearTimeout(rt); throw e; }),
          new Promise<string>((resolve) => { rt = setTimeout(() => resolve('zaman aşımı'), 12000); }),
        ]);
      } catch {
        return 'kopuk';
      }
    };
    try {
      const rows = await Promise.all(
        targets.map(async (tg) => {
          const [direct, via] = await Promise.all([
            probe(tg.url, tg.headers, tg.parse),
            probe(
              `${cleanUrl}?url=${encodeURIComponent(tg.url)}`,
              proxyService.workerHeaders(tg.url, tg.headers),
              tg.parse
            ),
          ]);
          return `${tg.name}: direkt ${direct} → worker ${via}`;
        })
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setProxyTestResult(rows.join('\n'));
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setProxyTestResult(`❌ Hata: ${e?.message || 'Bağlanılamadı'}`);
    } finally {
      setIsTestingProxy(false);
    }
  };

  const [isImporting, setIsImporting] = useState(false);

  const handlePickAndImportFile = async () => {
    setIsImporting(true);
    try {
      const res = await BackupService.pickAndImportFile();
      if (res) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Yedek Başarıyla Yüklendi! 🎉',
          `• ${res.favoritesImported.toLocaleString()} Yeni Favori Görsel\n• ${res.tagsImported} Favori Etiket\n• ${res.historyImported} Arama Geçmişi\n\nToplam Favori: ${res.totalFavorites.toLocaleString()}`
        );
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Hata', 'Dosya okunurken veya ayrıştırılırken bir sorun oluştu: ' + (e?.message || 'Bilinmeyen hata'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      Haptics.selectionAsync();
      const ok = await BackupService.exportBackup();
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e: any) {
      Alert.alert('Dışa Aktarma Hatası', e?.message || 'Yedek dışa aktarılamadı.');
    }
  };

  const handleClearHistory = () => {
    Alert.alert(
      'Arama Geçmişini Temizle',
      'Tüm kayıtlı arama geçmişiniz silinecektir. Onaylıyor musunuz?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Temizle',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await StorageService.clearSearchHistory();
            Alert.alert('Başarılı', 'Arama geçmişi temizlendi.');
          },
        },
      ]
    );
  };

  const handleClearCache = () => {
    Alert.alert(
      'Önbelleği Temizle',
      'Görsel disk ve bellek önbelleği ile geçici veriler silinecektir. Onaylıyor musunuz?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Temizle',
          style: 'destructive',
          onPress: async () => {
            try {
              clearCachedPosts();
              await Image.clearDiskCache();
              await Image.clearMemoryCache();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Başarılı', 'Önbellek başarıyla temizlendi.');
            } catch (e: any) {
              Alert.alert('Hata', 'Önbellek temizlenirken bir sorun oluştu.');
            }
          },
        },
      ]
    );
  };

  const handleTogglePasscode = (val: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (val) {
      setPasscodeModalMode('setup');
      setPasscodeModalVisible(true);
    } else {
      setPasscodeModalMode('disable');
      setPasscodeModalVisible(true);
    }
  };

  const handleChangePasscode = () => {
    Haptics.selectionAsync();
    setPasscodeModalMode('change');
    setPasscodeModalVisible(true);
  };

  const handleToggleBiometrics = async (val: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUseBiometrics(val);
    await SecurityService.setUseBiometrics(val);
  };

  const handlePasscodeModalSuccess = async () => {
    await refreshSecurityConfig();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Ayarlar</Text>
        <Text style={styles.headerSubtitle}>Kaynaklar, ağ ve tercihler</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={true}
      >
        {/* 1. Source Section (Most frequently used) */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Layers size={18} color={Colors.dark.primaryLight} />
            <Text style={styles.sectionTitle}>Booru Kaynağı Seçin</Text>
          </View>
          <Text style={styles.sectionDescription}>
            Görsellerin ve etiketlerin çekileceği ana görsel havuzunu belirleyin.
          </Text>

          <View style={styles.card}>
            {AVAILABLE_SOURCES.map((source, index) => {
              const isSelected = activeSource.id === source.id;
              return (
                <TouchableOpacity
                  key={source.id}
                  style={[
                    styles.sourceRow,
                    index !== AVAILABLE_SOURCES.length - 1 && styles.borderBottom,
                    isSelected && styles.sourceRowSelected,
                  ]}
                  onPress={() => handleSourceChange(source)}
                >
                  <View style={styles.sourceInfo}>
                    <View style={styles.sourceNameRow}>
                      <Text style={styles.sourceName}>{source.name}</Text>
                      {source.isSafeOnly && (
                        <View style={styles.safeBadge}>
                          <ShieldCheck size={12} color={Colors.dark.safe} />
                          <Text style={styles.safeBadgeText}>SFW</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.sourceDesc}>{source.description}</Text>
                  </View>

                  {isSelected && (
                    <View style={styles.checkCircle}>
                      <Check size={14} color="#FFFFFF" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 2. Image Quality Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ImageIcon size={18} color={GOLD_ACCENT} />
            <Text style={styles.sectionTitle}>Görsel Kalitesi</Text>
          </View>
          <Text style={styles.sectionDescription}>
            Görüntüleyicide görsellerin açılış kalitesini ve yakınlaştırma (zoom) davranışını belirleyin.
          </Text>

          <View style={styles.card}>
            {QUALITY_OPTIONS.map((opt, index) => {
              const isSelected = imageQuality === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[
                    styles.sourceRow,
                    index !== QUALITY_OPTIONS.length - 1 && styles.borderBottom,
                    isSelected && styles.sourceRowSelected,
                  ]}
                  onPress={() => handleQualityChange(opt.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.sourceInfo}>
                    <View style={styles.sourceNameRow}>
                      <Text style={styles.sourceName}>{opt.title}</Text>
                    </View>
                    <Text style={styles.sourceDesc}>{opt.desc}</Text>
                  </View>

                  {isSelected && (
                    <View style={styles.checkCircle}>
                      <Check size={14} color="#FFFFFF" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 3. Kara Liste Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <EyeOff size={18} color={GOLD_ACCENT} />
            <Text style={styles.sectionTitle}>Kara Liste</Text>
          </View>
          <Text style={styles.sectionDescription}>
            Engellenen etiketleri içeren gönderiler arama ve akışlarda otomatik olarak gizlenir.
          </Text>

          <View style={styles.card}>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                Haptics.selectionAsync();
                setIsBlacklistOpen((v) => !v);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.switchInfo}>
                <Text style={styles.switchTitle}>
                  Engellenen Etiketler{blacklistedTags.length > 0 ? ` (${blacklistedTags.length})` : ''}
                </Text>
                <Text style={styles.switchSub}>
                  {blacklistedTags.length === 0 ? 'Kara liste boş' : 'Listeyi görüntüle ve düzenle'}
                </Text>
              </View>
              <ChevronRight size={18} color={Colors.dark.textMuted} />
            </TouchableOpacity>

            {isBlacklistOpen && (
              <>
                {blacklistedTags.length === 0 ? (
                  <View style={[styles.emptyCardContent, styles.borderTop]}>
                    <Text style={styles.emptyCardText}>Kara liste boş</Text>
                  </View>
                ) : (
                  <>
                    {blacklistedTags.map((tag, index) => (
                      <View
                        key={`bl-tag-${tag}-${index}`}
                        style={[styles.blacklistRow, styles.borderTop]}
                      >
                        <Text style={styles.blacklistTagText} numberOfLines={1}>
                          {tag}
                        </Text>
                        <TouchableOpacity
                          style={styles.blacklistRemoveBtn}
                          onPress={() => handleRemoveBlacklistedTag(tag)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.7}
                        >
                          <X size={16} color={Colors.dark.danger} />
                        </TouchableOpacity>
                      </View>
                    ))}

                    <TouchableOpacity
                      style={[styles.actionRow, styles.borderTop]}
                      onPress={handleClearAllBlacklistedTags}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionRowText}>Tümünü Temizle</Text>
                      <Text style={styles.actionRowSub}>Tüm engellenen etiketleri listeden kaldır</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}
          </View>
        </View>

        {/* 4. Security & Passcode Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Shield size={18} color={GOLD_ACCENT} />
            <Text style={styles.sectionTitle}>Güvenlik & Passcode (Uygulama Kilidi)</Text>
          </View>
          <Text style={styles.sectionDescription}>
            Uygulamaya erişirken 4 haneli PIN ve biyometrik kilit doğrulaması isteyin.
          </Text>

          <View style={styles.card}>
            {/* Passcode Toggle */}
            <View style={[styles.switchRow, passcodeEnabled && styles.borderBottom]}>
              <View style={styles.switchInfo}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Lock size={15} color={passcodeEnabled ? GOLD_ACCENT : Colors.dark.textMuted} />
                  <Text style={styles.switchTitle}>Uygulama Kilidi (Passcode)</Text>
                </View>
                <Text style={styles.switchSub}>
                  {passcodeEnabled ? 'Aktif (4 Haneli PIN Koruması 🔒)' : 'Devre Dışı (Korumasız)'}
                </Text>
              </View>
              <Switch
                value={passcodeEnabled}
                onValueChange={handleTogglePasscode}
                trackColor={{ false: '#2C2D35', true: GOLD_ACCENT }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* Sub-options if Passcode is Enabled */}
            {passcodeEnabled && (
              <>
                {/* Biometrics Toggle (if hardware available) */}
                {hasBiometrics && (
                  <View style={[styles.switchRow, styles.borderBottom]}>
                    <View style={styles.switchInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {biometryType === 'Face ID' ? (
                          <ScanFace size={15} color={GOLD_ACCENT} />
                        ) : (
                          <Fingerprint size={15} color={GOLD_ACCENT} />
                        )}
                        <Text style={styles.switchTitle}>
                          {biometryType || 'Biyometrik'} ile Kilit Aç
                        </Text>
                      </View>
                      <Text style={styles.switchSub}>
                        {useBiometrics
                          ? `${biometryType || 'Biyometrik'} ile anında açılış`
                          : 'Yalnızca PIN kodu kullan'}
                      </Text>
                    </View>
                    <Switch
                      value={useBiometrics}
                      onValueChange={handleToggleBiometrics}
                      trackColor={{ false: '#2C2D35', true: GOLD_ACCENT }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                )}

                {/* Change Passcode */}
                <TouchableOpacity
                  style={styles.actionRow}
                  onPress={handleChangePasscode}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <KeyRound size={16} color={Colors.dark.primaryLight} />
                      <Text style={[styles.actionRowText, { color: Colors.dark.text, marginBottom: 0 }]}>
                        Passcode'u Değiştir
                      </Text>
                    </View>
                    <ChevronRight size={16} color={Colors.dark.textMuted} />
                  </View>
                  <Text style={[styles.actionRowSub, { marginTop: 4 }]}>
                    Mevcut 4 haneli PIN kodunuzu güncelleyin
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* 3. Data & Privacy Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Trash2 size={18} color={Colors.dark.danger} />
            <Text style={styles.sectionTitle}>Veri ve Depolama</Text>
          </View>
          <Text style={styles.sectionDescription}>
            Yerel arama geçmişi ve arama önbelleğini yönetin.
          </Text>

          <View style={styles.card}>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={handleClearHistory}
            >
              <Text style={styles.actionRowText}>Arama Geçmişini Temizle</Text>
              <Text style={styles.actionRowSub}>Cihazdaki kayıtlı arama ve etiket geçmişini sil</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Önbellek Bölümü */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <HardDrive size={18} color={Colors.dark.primaryLight} />
            <Text style={styles.sectionTitle}>Önbellek</Text>
          </View>
          <Text style={styles.sectionDescription}>
            Görsel disk ve bellek önbelleği ile geçici veri havuzunu yönetin.
          </Text>

          <View style={styles.card}>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={handleClearCache}
              activeOpacity={0.7}
            >
              <Text style={styles.actionRowText}>Önbelleği Temizle</Text>
              <Text style={styles.actionRowSub}>
                expo-image disk/bellek önbelleğini ve geçici gönderi verilerini sil
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 4. Backup & Transfer Section (Technical) */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <FolderDown size={18} color={GOLD_ACCENT} />
            <Text style={styles.sectionTitle}>Yedekleme & Aktarma</Text>
          </View>
          <Text style={styles.sectionDescription}>
            AnimeBoxes (.abbj) veya JSON yedek dosyalarınızı içe/dışa aktarın.
          </Text>

          <View style={styles.card}>
            {/* Pick Document (.abbj / .json) */}
            <TouchableOpacity
              style={[styles.actionRow, styles.borderBottom]}
              onPress={handlePickAndImportFile}
              disabled={isImporting}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <FolderUp size={16} color={Colors.dark.primaryLight} />
                <Text style={[styles.actionRowText, { color: Colors.dark.text }]}>
                  Dosyadan .abbj / JSON Seç ve Aktar
                </Text>
              </View>
              <Text style={styles.actionRowSub}>Cihazınızdaki AnimeBoxes veya JSON yedek dosyasını içe aktarın</Text>
            </TouchableOpacity>

            {/* Export Backup */}
            <TouchableOpacity
              style={styles.actionRow}
              onPress={handleExportBackup}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <Share2 size={16} color="#51CF66" />
                <Text style={[styles.actionRowText, { color: Colors.dark.text }]}>
                  Tüm Favorileri Dışa Aktar (JSON)
                </Text>
              </View>
              <Text style={styles.actionRowSub}>Mevcut favorileri ve etiketleri dosya olarak kaydet / paylaş</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 5. Network & Bypass (Cloudflare Worker Proxy - Technical) */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Radio size={18} color={GOLD_ACCENT} />
            <Text style={styles.sectionTitle}>Ağ & Bypass (Cloudflare Relay)</Text>
          </View>
          <Text style={styles.sectionDescription}>
            ISS sansürlerini VPN'e gerek kalmadan aşmak için Cloudflare Worker ters proxy köprüsünü etkinleştirin.
          </Text>

          <View style={styles.card}>
            {/* Toggle Row */}
            <View style={[styles.switchRow, styles.borderBottom]}>
              <View style={styles.switchInfo}>
                <Text style={styles.switchTitle}>Gömülü Proxy Köprüsü</Text>
                <Text style={styles.switchSub}>
                  {proxyEnabled ? 'Aktif (Tüm trafik Worker üzerinden geçer)' : 'Devre Dışı'}
                </Text>
              </View>
              <Switch
                value={proxyEnabled}
                onValueChange={handleToggleProxy}
                trackColor={{ false: '#2C2D35', true: GOLD_ACCENT }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* URL Input Row */}
            <View style={styles.workerInputWrapper}>
              <Text style={styles.inputLabel}>Cloudflare Worker URL:</Text>
              <TextInput
                style={styles.workerInput}
                placeholder="https://booru-proxy.kullanici.workers.dev"
                placeholderTextColor="#686E7D"
                value={workerUrl}
                onChangeText={handleSaveWorkerUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />

              {/* Test Button & Result */}
              <View style={styles.testBtnRow}>
                <TouchableOpacity
                  style={[styles.testButton, isTestingProxy && styles.testButtonDisabled]}
                  onPress={handleTestProxy}
                  disabled={isTestingProxy}
                  activeOpacity={0.7}
                >
                  {isTestingProxy ? (
                    <ActivityIndicator size="small" color="#111216" />
                  ) : (
                    <>
                      <Zap size={15} color="#111216" />
                      <Text style={styles.testButtonText}>Bağlantıyı Test Et</Text>
                    </>
                  )}
                </TouchableOpacity>

                {proxyTestResult && (
                  <Text style={styles.testResultText}>{proxyTestResult}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Gelbooru API Anahtarı */}
          <View style={styles.workerInputWrapper}>
            <Text style={styles.inputLabel}>Gelbooru API Anahtarı (DAPI & Rate Limit):</Text>
            <Text style={styles.switchSub}>
              gelbooru.com → Account Options / Profile sayfasından api_key ve user_id alın. DAPI erişimini açar ve istek kısıtlamalarını (rate limit) önler.
            </Text>
            <TextInput
              style={styles.workerInput}
              placeholder="user_id (örn: 123456)"
              placeholderTextColor="#686E7D"
              value={gelbooruUserId}
              onChangeText={setGelbooruUserId}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.workerInput, { marginTop: 8 }]}
              placeholder="api_key"
              placeholderTextColor="#686E7D"
              value={gelbooruApiKey}
              onChangeText={setGelbooruApiKey}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <View style={styles.testBtnRow}>
              <TouchableOpacity style={styles.testButton} onPress={handleSaveGelbooruAuth} activeOpacity={0.7}>
                <Check size={15} color="#111216" />
                <Text style={styles.testButtonText}>Kaydet</Text>
              </TouchableOpacity>
              {gelbooruAuthSaved && (
                <Text style={styles.testResultText}>✅ Kayıtlı — Gelbooru istekleri anahtarla gidiyor</Text>
              )}
            </View>
            {(gelbooruUserId.length > 0 || gelbooruApiKey.length > 0) && (
              <TouchableOpacity
                style={[styles.actionRow, { marginTop: 4 }]}
                onPress={handleClearGelbooruAuth}
                activeOpacity={0.7}
              >
                <Text style={styles.actionRowText}>Anahtarı Sil</Text>
                <Text style={styles.actionRowSub}>Anonim limitlere dön</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 6. About & iOS Build info */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Smartphone size={18} color={Colors.dark.primaryLight} />
            <Text style={styles.sectionTitle}>Uygulama Bilgisi</Text>
          </View>

          <View style={styles.card}>
            <View style={[styles.infoRow, styles.borderBottom]}>
              <Text style={styles.infoLabel}>Platform</Text>
              <Text style={styles.infoValue}>iOS / React Native (Expo SDK 57)</Text>
            </View>

            <View style={[styles.infoRow, styles.borderBottom]}>
              <Text style={styles.infoLabel}>Sürüm</Text>
              <Text style={styles.infoValue}>1.0.0</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Bypass Modu</Text>
              <Text style={styles.infoValue}>{proxyEnabled ? 'Cloudflare Relay (Aktif)' : 'Doğrudan Bağlantı'}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Passcode Management Modal */}
      <PasscodeModal
        visible={passcodeModalVisible}
        mode={passcodeModalMode}
        onClose={() => setPasscodeModalVisible(false)}
        onSuccess={handlePasscodeModalSuccess}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.dark.text,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  sectionDescription: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    marginBottom: 10,
    lineHeight: 16,
  },
  card: {
    backgroundColor: Colors.dark.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.dark.cardBorder,
    overflow: 'hidden',
  },
  borderBottom: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
  },
  emptyCardContent: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCardText: {
    fontSize: 14,
    color: Colors.dark.textMuted,
  },
  blacklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  blacklistTagText: {
    fontSize: 14,
    color: Colors.dark.text,
    flex: 1,
    marginRight: 12,
  },
  blacklistRemoveBtn: {
    padding: 4,
  },

  /* Proxy Section Styles */
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  switchInfo: {
    flex: 1,
    marginRight: 12,
  },
  switchTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  switchSub: {
    fontSize: 12,
    color: Colors.dark.textMuted,
  },
  workerInputWrapper: {
    padding: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    marginBottom: 6,
  },
  workerInput: {
    backgroundColor: '#111216',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    marginBottom: 10,
  },
  testBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: GOLD_ACCENT,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  testButtonDisabled: {
    opacity: 0.6,
  },
  testButtonText: {
    color: '#111216',
    fontSize: 12,
    fontWeight: '700',
  },
  testResultText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    flex: 1,
  },

  /* Sources Styles */
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  sourceRowSelected: {
    backgroundColor: 'rgba(108, 99, 255, 0.08)',
  },
  sourceInfo: {
    flex: 1,
    marginRight: 12,
  },
  sourceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  sourceName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  safeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(81, 207, 102, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  safeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.dark.safe,
  },
  sourceDesc: {
    fontSize: 12,
    color: Colors.dark.textMuted,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    padding: 14,
  },
  actionRowText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.danger,
    marginBottom: 2,
  },
  actionRowSub: {
    fontSize: 12,
    color: Colors.dark.textMuted,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  infoLabel: {
    fontSize: 13,
    color: Colors.dark.textMuted,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
  },
});
