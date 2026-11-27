import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { BooruSource } from '../types/booru';
import { Colors } from '../theme/colors';
import {
  captureNativeSiteCookies,
  clearSiteSession,
  getSiteLoginUrl,
  hasSiteSession,
  saveSiteSession,
} from '../services/siteSession';

const GOLD_ACCENT = '#F5A623';

interface SiteLoginModalProps {
  visible: boolean;
  source: BooruSource;
  onClose: () => void;
  onSessionChanged: () => void;
}

/**
 * One-shot interactive login modal. Once the user taps Done, native iOS
 * WKHTTPCookieStore reads the HttpOnly session cookies (and RedGifs JWT if
 * present) into persistent storage, and the WebView unmounts completely.
 * All subsequent feed, search, and video-detail requests use pure fetch().
 */
export const SiteLoginModal: React.FC<SiteLoginModalProps> = ({
  visible,
  source,
  onClose,
  onSessionChanged,
}) => {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const capturedTokenRef = useRef<string>('');
  const [loadError, setLoadError] = useState<{ code?: number; description?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const loginUrl = useMemo(() => getSiteLoginUrl(source), [source]);
  const signedIn = hasSiteSession(source.id);

  useEffect(() => {
    if (visible) {
      setLoadError(null);
      setSaving(false);
      capturedTokenRef.current = '';
    }
  }, [visible, loginUrl]);

  const tokenProbeScript = useMemo(() => {
    if (source.type !== 'redgifs') return '';
    return `(function(){
      try {
        var stores = [window.localStorage, window.sessionStorage];
        for (var s = 0; s < stores.length; s++) {
          var st = stores[s];
          if (!st) continue;
          for (var i = 0; i < st.length; i++) {
            var v = st.getItem(st.key(i)) || '';
            var m = v.match(/eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}/);
            if (m) {
              var p = JSON.parse(atob(m[0].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
              if (p && p.sub && !/^temp/i.test(String(p.sub))) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ rgToken: m[0] }));
                return;
              }
            }
          }
        }
      } catch (e) {}
    })(); true;`;
  }, [source.type]);

  const handleDone = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (tokenProbeScript) {
        try {
          webViewRef.current?.injectJavaScript(tokenProbeScript);
          await new Promise((r) => setTimeout(r, 150));
        } catch {}
      }
      if (capturedTokenRef.current) {
        await saveSiteSession(source.id, { bearerToken: capturedTokenRef.current });
      }
      await captureNativeSiteCookies(source);
    } finally {
      setSaving(false);
      onSessionChanged();
    }
  };

  const handleSignOut = async () => {
    await clearSiteSession(source);
    onSessionChanged();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.modalContainer,
          { paddingTop: Math.max(insets.top, 12), paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Close</Text>
          </TouchableOpacity>
          <View style={styles.modalTitleGroup}>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {source.name}
            </Text>
          </View>
          {signedIn && (
            <TouchableOpacity onPress={handleSignOut} style={styles.headerBtn} activeOpacity={0.7}>
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleDone}
            disabled={saving}
            style={[styles.headerBtn, styles.doneBtn]}
            activeOpacity={0.7}
          >
            <Text style={styles.doneText}>{saving ? '...' : 'Done'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.webViewWrap}>
          <WebView
            ref={webViewRef}
            source={{ uri: loginUrl }}
            style={styles.loginWebView}
            originWhitelist={['*']}
            applicationNameForUserAgent="Version/18.0 Safari/604.1"
            javaScriptEnabled
            javaScriptCanOpenWindowsAutomatically
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            incognito={false}
            allowsBackForwardNavigationGestures
            mediaPlaybackRequiresUserAction
            allowsInlineMediaPlayback={false}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            setSupportMultipleWindows={false}
            onMessage={(e) => {
              try {
                const parsed = JSON.parse(e.nativeEvent.data);
                if (typeof parsed?.rgToken === 'string' && parsed.rgToken) {
                  capturedTokenRef.current = parsed.rgToken;
                }
              } catch {}
            }}
            onLoadEnd={() => {
              if (tokenProbeScript) {
                try { webViewRef.current?.injectJavaScript(tokenProbeScript); } catch {}
              }
            }}
            onLoadStart={() => setLoadError(null)}
            onError={(e) => {
              const ne = e?.nativeEvent;
              if (ne?.code === -999) return;
              const failedUrl = String(ne?.url || '');
              try {
                const loginHost = new URL(loginUrl).hostname.replace(/^www\./, '');
                if (failedUrl && !failedUrl.includes(loginHost)) return;
              } catch {}
              setLoadError({ code: ne?.code, description: ne?.description });
            }}
          />
          {loadError && (
            <View style={styles.errorOverlay}>
              <Text style={styles.errorOverlayTitle}>
                Could not reach {source.name}
                {loadError.code ? ` (${loadError.code})` : ''}
              </Text>
              <Text style={styles.errorOverlayDesc}>
                {loadError.code === -1005 || loadError.code === -1001 || loadError.code === -1200
                  ? 'Your network/ISP reset the direct connection to this login page. Enable a VPN to sign in, or close to browse without an account.'
                  : loadError.description || 'The login page failed to load.'}
              </Text>
              <TouchableOpacity
                style={[styles.headerBtn, styles.doneBtn, { marginTop: 14, paddingHorizontal: 18 }]}
                onPress={() => {
                  setLoadError(null);
                  webViewRef.current?.reload();
                }}
                activeOpacity={0.75}
              >
                <Text style={styles.doneText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  modalTitleGroup: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 6,
  },
  modalTitle: {
    textAlign: 'center',
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '700',
  },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  doneBtn: {
    backgroundColor: GOLD_ACCENT,
  },
  cancelText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  signOutText: {
    color: '#FF6B6B',
    fontSize: 13,
    fontWeight: '600',
  },
  doneText: {
    color: '#111216',
    fontSize: 14,
    fontWeight: '700',
  },
  webViewWrap: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#111216',
  },
  loginWebView: {
    flex: 1,
    backgroundColor: '#111216',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.dark.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  errorOverlayTitle: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorOverlayDesc: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
  },
});
