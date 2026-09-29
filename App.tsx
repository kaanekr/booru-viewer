import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  StatusBar as RNStatusBar,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Compass, Search, Heart, SlidersHorizontal } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';

import { SecurityService } from './src/services/securityService';
import { StorageService } from './src/services/storage';
import { proxyService } from './src/services/proxyService';
import { booruApi } from './src/services/booruApi';
import { LockScreen } from './src/components/LockScreen';
import { Colors } from './src/theme/colors';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { navigationRef } from './src/navigation/rootNavigation';
import type { RootStackParamList, TabParamList } from './src/navigation/types';
import { SourceProvider, useSource } from './src/context/SourceContext';
import { MediaPlaybackContext, useAppForeground } from './src/context/MediaPlaybackContext';
import { setGridPreviewsEnabled } from './src/utils/gridPreviews';
import { ViewerScreen } from './src/screens/ViewerScreen';
import { SearchDetailScreen } from './src/screens/SearchDetailScreen';

import { FeedScreen } from './src/screens/FeedScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { FavoritesScreen } from './src/screens/FavoritesScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { startFreezeProbe, updateFreezeProbe, recordFreezeEvent, recordRootTouch } from './src/utils/freezeProbe';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SourceProvider>
        <MainApp />
      </SourceProvider>
    </SafeAreaProvider>
  );
}

function MainTabsNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenListeners={{
        tabPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.dark.primaryLight,
        tabBarInactiveTintColor: Colors.dark.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.dark.tabBar,
          borderTopWidth: 1,
          borderTopColor: Colors.dark.divider,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 10),
          height: 56 + Math.max(insets.bottom, 10),
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={{
          tabBarLabel: 'Keşfet',
          tabBarIcon: ({ color }) => <Compass size={22} color={color} />,
        }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{
          tabBarLabel: 'Arama',
          tabBarIcon: ({ color }) => <Search size={22} color={color} />,
        }}
      />
      <Tab.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{
          tabBarLabel: 'Favoriler',
          tabBarActiveTintColor: '#FF4D4F',
          tabBarIcon: ({ color, focused }) => (
            <Heart
              size={22}
              color={color}
              fill={focused ? '#FF4D4F' : 'transparent'}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Ayarlar',
          tabBarIcon: ({ color }) => <SlidersHorizontal size={22} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

function MainApp() {
  const { isReady: isSourceReady, activeSource } = useSource();
  const [isAppReady, setIsAppReady] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const isForeground = useAppForeground();

  useEffect(() => startFreezeProbe(), []);
  useEffect(() => {
    updateFreezeProbe({ appState: AppState.currentState, locked: isLocked, source: activeSource.id });
    recordFreezeEvent(`app=${AppState.currentState} locked=${isLocked} source=${activeSource.id}`);
  }, [isForeground, isLocked, activeSource.id]);

  // Initialize proxy & security lock synchronously before rendering
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    // Izgara önizleme tercihi: kartlar açılıştan itibaren doğru davransın
    StorageService.getGridPreviews().then(setGridPreviewsEnabled).catch(() => {});
    async function initApp() {
      try {
        const [, isPasscodeSet] = await Promise.all([
          proxyService.init(),
          SecurityService.isPasscodeEnabled(),
        ]);

        // RedGifs her istekte geçici token ister; kaynak hazır olur olmaz
        // ısıtılırsa Keşfet auth turunu beklemez.
        if (activeSource.type === 'redgifs') {
          booruApi.warmupRedGifs();
        }

        if (isPasscodeSet) {
          setIsLocked(true);
        }
      } finally {
        setIsAppReady(true);
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

  if (!isSourceReady || !isAppReady) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <RNStatusBar barStyle="light-content" />
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      onTouchStart={() => recordRootTouch('start')}
      onTouchEnd={() => recordRootTouch('end')}
      onTouchCancel={() => recordRootTouch('end')}
    >
      <MediaPlaybackContext.Provider value={isForeground && !isLocked}>
        <NavigationContainer
          ref={navigationRef}
          onReady={() => updateFreezeProbe({ route: navigationRef.getCurrentRoute()?.name || 'unknown' })}
          onStateChange={() => {
            const route = navigationRef.getCurrentRoute()?.name || 'unknown';
            updateFreezeProbe({ route });
            recordFreezeEvent(`route=${route}`);
          }}
        >
          <RootStack.Navigator
            screenOptions={{
              headerShown: false,
              animation: 'slide_from_right',
              gestureEnabled: true,
              contentStyle: { backgroundColor: Colors.dark.background },
            }}
          >
            <RootStack.Screen name="MainTabs" component={MainTabsNavigator} />
            <RootStack.Screen
              name="Viewer"
              component={ViewerScreen}
              options={{
                headerShown: false,
                animation: 'slide_from_right',
              }}
            />
            <RootStack.Screen
              name="SearchDetail"
              component={SearchDetailScreen}
              options={{
                headerShown: false,
                animation: 'slide_from_right',
                gestureEnabled: true,
              }}
            />
          </RootStack.Navigator>
        </NavigationContainer>
      </MediaPlaybackContext.Provider>

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
});
