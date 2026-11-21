import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  Platform,
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
import { syncNativeVideoCacheSize } from './src/utils/videoFallbackCache';
import { ViewerScreen } from './src/screens/ViewerScreen';
import { SearchDetailScreen } from './src/screens/SearchDetailScreen';

import { FeedScreen } from './src/screens/FeedScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { FavoritesScreen } from './src/screens/FavoritesScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { startFreezeProbe, updateFreezeProbe, recordFreezeEvent, recordRootTouch } from './src/utils/freezeProbe';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const DEV_TOUCH_HANDLERS =
  typeof __DEV__ !== 'undefined' && __DEV__
    ? {
        onTouchStart: () => recordRootTouch('start'),
        onTouchEnd: () => recordRootTouch('end'),
        onTouchCancel: () => recordRootTouch('end'),
      }
    : undefined;

const STACK_SCREEN_OPTIONS = {
  headerShown: false,
  animation: 'slide_from_right' as const,
  gestureEnabled: true,
  contentStyle: { backgroundColor: Colors.dark.background },
};

const VIEWER_SCREEN_OPTIONS = {
  headerShown: false,
  animation: 'slide_from_right' as const,
  fullScreenGestureEnabled: true,
  gestureResponseDistance: { end: 48 },
  animationMatchesGesture: true,
};

const SEARCH_DETAIL_SCREEN_OPTIONS = {
  headerShown: false,
  animation: 'slide_from_right' as const,
  gestureEnabled: true,
};

function SourceReadyGate({ children }: { children: React.ReactNode }) {
  const { isReady } = useSource();
  if (!isReady) {
    return <View style={styles.container} />;
  }
  return <>{children}</>;
}

function SourceWarmupProbe() {
  const { isReady, activeSource } = useSource();

  useEffect(() => {
    updateFreezeProbe({ source: activeSource.id });
    recordFreezeEvent(`source=${activeSource.id}`);
  }, [activeSource.id]);

  useEffect(() => {
    // The saved source is restored asynchronously, after the launch effect.
    if (isReady && activeSource.type === 'redgifs') {
      void booruApi.warmupRedGifs();
    }
  }, [isReady, activeSource.type]);

  return null;
}

function AppMediaPlaybackProvider({
  isLocked,
  checkingBackgroundLock,
  children,
}: {
  isLocked: boolean;
  checkingBackgroundLock: boolean;
  children: React.ReactNode;
}) {
  const isForeground = useAppForeground();
  return (
    <MediaPlaybackContext.Provider value={isForeground && !isLocked && !checkingBackgroundLock}>
      {children}
    </MediaPlaybackContext.Provider>
  );
}

function PrivacyCover({
  isLocked,
  checkingBackgroundLock,
}: {
  isLocked: boolean;
  checkingBackgroundLock: boolean;
}) {
  const isForeground = useAppForeground();

  useEffect(() => {
    updateFreezeProbe({ appState: AppState.currentState ?? 'unknown', locked: isLocked });
    recordFreezeEvent(`app=${AppState.currentState} locked=${isLocked}`);
  }, [isForeground, isLocked]);

  if (!isLocked && (!isForeground || checkingBackgroundLock)) {
    return <View style={styles.lockOverlay} testID="app-privacy-cover" accessibilityViewIsModal />;
  }
  return null;
}

export default function App() {
  const mainApp = useMemo(() => <MainApp />, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SourceProvider>
        <SourceReadyGate>{mainApp}</SourceReadyGate>
      </SourceProvider>
    </SafeAreaProvider>
  );
}

function MainTabsNavigator() {
  const insets = useSafeAreaInsets();

  const screenListeners = useCallback(
    ({ navigation }: { navigation: { isFocused: () => boolean } }) => ({
      tabPress: () => {
        if (!navigation.isFocused() && Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      },
    }),
    []
  );

  const screenOptions = useMemo(
    () => ({
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
        fontWeight: '600' as const,
      },
    }),
    [insets.bottom]
  );

  return (
    <Tab.Navigator
      screenListeners={screenListeners}
      screenOptions={screenOptions}
    >
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={{
          tabBarLabel: 'Explore',
          tabBarIcon: ({ color }) => <Compass size={22} color={color} />,
        }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{
          tabBarLabel: 'Search',
          tabBarIcon: ({ color }) => <Search size={22} color={color} />,
        }}
      />
      <Tab.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{
          tabBarLabel: 'Favorites',
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
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color }) => <SlidersHorizontal size={22} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

function MainApp() {
  const [isAppReady, setIsAppReady] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [checkingBackgroundLock, setCheckingBackgroundLock] = useState(false);

  useEffect(() => startFreezeProbe(), []);

  // Initialize proxy & security lock synchronously before rendering
  useEffect(() => {
    if (Platform.OS !== 'web') {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
    // Grid preview preference: cards behave correctly from launch
    StorageService.getGridPreviews().then(setGridPreviewsEnabled).catch(() => {});
    async function initApp() {
      try {
        const [, isPasscodeSet] = await Promise.all([
          proxyService.init(),
          SecurityService.isPasscodeEnabled(),
          syncNativeVideoCacheSize(),
        ]);

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
    let disposed = false;
    let lockRequestId = 0;
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      // iOS system prompts also emit inactive. Cover content there, but don't
      // mount a biometric lock on top of an existing system dialog.
      if (nextAppState === 'background') {
        const requestId = ++lockRequestId;
        setCheckingBackgroundLock(true);
        try {
          const isPasscodeSet = await SecurityService.isPasscodeEnabled();
          if (!disposed && requestId === lockRequestId && isPasscodeSet) setIsLocked(true);
        } catch {
          if (!disposed && requestId === lockRequestId) setIsLocked(true);
        } finally {
          if (!disposed && requestId === lockRequestId) setCheckingBackgroundLock(false);
        }
      }
    });

    return () => {
      disposed = true;
      subscription.remove();
    };
  }, []);

  const handleUnlockSuccess = useCallback(() => {
    setIsLocked(false);
  }, []);

  const handleNavReady = useCallback(() => {
    updateFreezeProbe({ route: navigationRef.getCurrentRoute()?.name || 'unknown' });
  }, []);

  const handleNavStateChange = useCallback(() => {
    const route = navigationRef.getCurrentRoute()?.name || 'unknown';
    updateFreezeProbe({ route });
    recordFreezeEvent(`route=${route}`);
  }, []);

  const navigationTree = useMemo(
    () => (
      <NavigationContainer
        ref={navigationRef}
        onReady={handleNavReady}
        onStateChange={handleNavStateChange}
      >
        <RootStack.Navigator screenOptions={STACK_SCREEN_OPTIONS}>
          <RootStack.Screen name="MainTabs" component={MainTabsNavigator} />
          <RootStack.Screen
            name="Viewer"
            component={ViewerScreen}
            options={VIEWER_SCREEN_OPTIONS}
          />
          <RootStack.Screen
            name="SearchDetail"
            component={SearchDetailScreen}
            options={SEARCH_DETAIL_SCREEN_OPTIONS}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    ),
    [handleNavReady, handleNavStateChange]
  );

  if (!isAppReady) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container} {...DEV_TOUCH_HANDLERS}>
      <SourceWarmupProbe />
      <AppMediaPlaybackProvider isLocked={isLocked} checkingBackgroundLock={checkingBackgroundLock}>
        {navigationTree}
      </AppMediaPlaybackProvider>

      {/* App Lock Screen Overlay */}
      {isLocked && (
        <View style={styles.lockOverlay}>
          <LockScreen
            mode="unlock"
            onSuccess={handleUnlockSuccess}
          />
        </View>
      )}
      <PrivacyCover isLocked={isLocked} checkingBackgroundLock={checkingBackgroundLock} />
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
