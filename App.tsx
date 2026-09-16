import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  StatusBar as RNStatusBar,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Compass, Search, Heart, SlidersHorizontal } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { BooruSource } from './src/types/booru';
import { AVAILABLE_SOURCES, DEFAULT_SOURCE } from './src/services/sources';
import { booruApi } from './src/services/booruApi';
import { StorageService } from './src/services/storage';
import { SecurityService } from './src/services/securityService';
import { proxyService } from './src/services/proxyService';
import { LockScreen } from './src/components/LockScreen';
import { Colors } from './src/theme/colors';

import { FeedScreen } from './src/screens/FeedScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { FavoritesScreen } from './src/screens/FavoritesScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

type TabType = 'feed' | 'search' | 'favorites' | 'settings';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <MainApp />
    </SafeAreaProvider>
  );
}

function MainApp() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>('feed');
  const [activeSource, setActiveSource] = useState<BooruSource>(DEFAULT_SOURCE);
  const [searchTarget, setSearchTarget] = useState<{
    tag: string;
    mode: 'replace' | 'add' | 'exclude';
  } | undefined>(undefined);
  const [isReady, setIsReady] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  // Initialize stored source, proxy & security lock synchronously before rendering
  useEffect(() => {
    async function initApp() {
      try {
        const [,, isPasscodeSet] = await Promise.all([
          proxyService.init(),
          StorageService.getActiveSourceId().then((savedId) => {
            const found = AVAILABLE_SOURCES.find((s) => s.id === savedId) || DEFAULT_SOURCE;
            setActiveSource(found);
            booruApi.setSource(found);
          }),
          SecurityService.isPasscodeEnabled(),
        ]);

        if (isPasscodeSet) {
          setIsLocked(true);
        }
      } finally {
        setIsReady(true);
      }
    }
    initApp();
  }, []);

  // Listen to AppState transitions for instant auto-lock
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        const isPasscodeSet = await SecurityService.isPasscodeEnabled();
        if (isPasscodeSet) {
          setIsLocked(true);
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const handleSelectSource = async (source: BooruSource) => {
    setActiveSource(source);
    booruApi.setSource(source);
    await StorageService.setActiveSourceId(source.id);
  };

  const handleNavigateToSearchWithTag = (
    tag: string,
    mode: 'replace' | 'add' | 'exclude' = 'replace'
  ) => {
    setSearchTarget({ tag, mode });
    setActiveTab('search');
  };

  const handleTabPress = (tab: TabType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(tab);
  };

  if (!isReady) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <RNStatusBar barStyle="light-content" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Screen Views (Keep-Alive) */}
      <View style={styles.contentArea}>
        <View
          style={[
            styles.screenContainer,
            activeTab === 'feed' ? styles.screenVisible : styles.screenHidden,
          ]}
        >
          <FeedScreen
            activeSource={activeSource}
            onSelectTag={handleNavigateToSearchWithTag}
            onOpenSourcePicker={() => setActiveTab('settings')}
          />
        </View>

        <View
          style={[
            styles.screenContainer,
            activeTab === 'search' ? styles.screenVisible : styles.screenHidden,
          ]}
        >
          <SearchScreen
            initialTag={searchTarget?.tag}
            initialMode={searchTarget?.mode}
            activeSource={activeSource}
            onClearInitialTag={() => setSearchTarget(undefined)}
            onOpenSourcePicker={() => setActiveTab('settings')}
          />
        </View>

        <View
          style={[
            styles.screenContainer,
            activeTab === 'favorites' ? styles.screenVisible : styles.screenHidden,
          ]}
        >
          <FavoritesScreen
            isActive={activeTab === 'favorites'}
            onSelectTag={handleNavigateToSearchWithTag}
          />
        </View>

        <View
          style={[
            styles.screenContainer,
            activeTab === 'settings' ? styles.screenVisible : styles.screenHidden,
          ]}
        >
          <SettingsScreen
            activeSource={activeSource}
            onSelectSource={handleSelectSource}
          />
        </View>
      </View>

      {/* Bottom Tab Bar */}
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => handleTabPress('feed')}
          activeOpacity={0.7}
        >
          <Compass
            size={22}
            color={activeTab === 'feed' ? Colors.dark.primaryLight : Colors.dark.textMuted}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'feed' && styles.tabLabelActive,
            ]}
          >
            Keşfet
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => handleTabPress('search')}
          activeOpacity={0.7}
        >
          <Search
            size={22}
            color={activeTab === 'search' ? Colors.dark.primaryLight : Colors.dark.textMuted}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'search' && styles.tabLabelActive,
            ]}
          >
            Arama
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => handleTabPress('favorites')}
          activeOpacity={0.7}
        >
          <Heart
            size={22}
            color={activeTab === 'favorites' ? '#FF4D4F' : Colors.dark.textMuted}
            fill={activeTab === 'favorites' ? '#FF4D4F' : 'transparent'}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'favorites' && { color: '#FF4D4F' },
            ]}
          >
            Favoriler
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tabItem}
          onPress={() => handleTabPress('settings')}
          activeOpacity={0.7}
        >
          <SlidersHorizontal
            size={22}
            color={activeTab === 'settings' ? Colors.dark.primaryLight : Colors.dark.textMuted}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'settings' && styles.tabLabelActive,
            ]}
          >
            Ayarlar
          </Text>
        </TouchableOpacity>
      </View>

      {/* App Lock Screen Overlay */}
      {isLocked && (
        <View style={styles.lockOverlay}>
          <LockScreen
            mode="unlock"
            onSuccess={() => {
              setIsLocked(false);
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999999,
    backgroundColor: '#0D0E12',
  },
  contentArea: {
    flex: 1,
    position: 'relative',
  },
  screenContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  screenVisible: {
    opacity: 1,
    zIndex: 1,
  },
  screenHidden: {
    opacity: 0,
    zIndex: 0,
    pointerEvents: 'none',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.tabBar,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.divider,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.textMuted,
  },
  tabLabelActive: {
    color: Colors.dark.primaryLight,
  },
});


