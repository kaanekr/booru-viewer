import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

interface WebmWebViewPlayerProps {
  url: string;
  posterUrl?: string;
  width: number;
  height: number;
  suspended?: boolean;
  onError?: () => void;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getBaseOrigin(url: string): string {
  try {
    return new URL(url).origin + '/';
  } catch {
    return 'https://localhost/';
  }
}

/**
 * iOS WKWebView fallback player for WebM-only videos when AVPlayer cannot play
 * them and no MP4 counterpart exists on the server. Falls back via `onError`
 * if WebKit rejects the codec or fails to load.
 */
export const WebmWebViewPlayer: React.FC<WebmWebViewPlayerProps> = React.memo(
  ({ url, posterUrl, width, height, suspended = false, onError }) => {
    const webViewRef = useRef<any>(null);
    const failedRef = useRef(false);
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    useEffect(() => {
      failedRef.current = false;
    }, [url]);

    useEffect(() => {
      if (!webViewRef.current) return;
      if (suspended) {
        webViewRef.current.injectJavaScript(
          'try{var v=document.getElementById("v");if(v)v.pause();}catch(e){}true;'
        );
      } else {
        webViewRef.current.injectJavaScript(
          'try{var v=document.getElementById("v");if(v&&v.paused)v.play().catch(function(){});}catch(e){}true;'
        );
      }
    }, [suspended]);

    const html = useMemo(() => {
      const safeSrc = escapeHtmlAttr(url);
      const safePoster = posterUrl ? escapeHtmlAttr(posterUrl) : '';
      return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;}
  video{width:100%;height:100%;object-fit:contain;background:#000;}
</style>
</head>
<body>
  <video id="v" src="${safeSrc}"${safePoster ? ` poster="${safePoster}"` : ''} playsinline webkit-playsinline autoplay loop controls preload="auto"></video>
  <script>
    (function(){
      var v = document.getElementById('v');
      var settled = false;
      function notify(type){
        if (settled) return;
        settled = true;
        try { window.ReactNativeWebView.postMessage(type); } catch(e) {}
      }
      if (!v) { notify('error'); return; }
      v.addEventListener('loadeddata', function(){ notify('ready'); }, { once: true });
      v.addEventListener('error', function(){ notify('error'); }, { once: true });
      setTimeout(function(){
        if (!settled && v.readyState < 2) notify('error');
      }, 12000);
    })();
  </script>
</body>
</html>`;
    }, [url, posterUrl]);

    const baseUrl = useMemo(() => getBaseOrigin(url), [url]);

    const handleMessage = (event: WebViewMessageEvent) => {
      if (event.nativeEvent.data === 'error' && !failedRef.current) {
        failedRef.current = true;
        onErrorRef.current?.();
      }
    };

    return (
      <View style={[styles.container, { width, height }]}>
        <WebView
          ref={webViewRef}
          source={{ html, baseUrl }}
          originWhitelist={['*']}
          style={styles.webview}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo={false}
          scrollEnabled={false}
          bounces={false}
          onMessage={handleMessage}
          onError={() => {
            if (!failedRef.current) {
              failedRef.current = true;
              onErrorRef.current?.();
            }
          }}
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
