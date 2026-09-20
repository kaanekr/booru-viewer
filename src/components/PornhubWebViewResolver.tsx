import React, { useMemo, useRef } from 'react';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { parsePornhubDetail } from '../services/pornhub';
import type { PornhubFiles } from '../services/pornhub';

interface Props {
  pageUrl: string;
  onResolve: (files: PornhubFiles | null) => void;
}

/**
 * Pornhub bot-duvarı (JS proof-of-work) RN fetch'i engellediğinde yedek yol:
 * gerçek Safari motorlu gizli WebView challenge'ı kendi çözer, ardından
 * `mediaDefinitions` bloğu RN tarafına post'lanır ve mevcut parser ile
 * HLS akışlarına çevrilir. Cookie'ler WebView'da kalıcıdır.
 */
export const PornhubWebViewResolver: React.FC<Props> = ({ pageUrl, onResolve }) => {
  const doneRef = useRef(false);

  const injected = useMemo(
    () => `(function(){
      var tries = 0;
      var timer = setInterval(function(){
        tries++;
        try {
          var html = document.documentElement ? (document.documentElement.innerHTML || '') : '';
          var i = html.indexOf('mediaDefinitions');
          if (i >= 0) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ ok: true, chunk: html.slice(i, i + 40000) }));
            clearInterval(timer);
          } else if (tries >= 25) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false, reason: 'nomedia:' + document.title }));
            clearInterval(timer);
          }
        } catch (e) {
          if (tries >= 25) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false, reason: 'error' }));
            clearInterval(timer);
          }
        }
      }, 1000);
    })();
    true;`,
    []
  );

  const handleMessage = (e: WebViewMessageEvent) => {
    if (doneRef.current) return;
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (!data || data.ok !== true || typeof data.chunk !== 'string') {
        doneRef.current = true;
        onResolve(null);
        return;
      }
      const files = parsePornhubDetail(data.chunk);
      doneRef.current = true;
      onResolve(files.high || files.hls || files.low ? files : null);
    } catch {
      doneRef.current = true;
      onResolve(null);
    }
  };

  return (
    <WebView
      source={{ uri: pageUrl }}
      style={{ width: 1, height: 1, position: 'absolute', opacity: 0 }}
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      mediaPlaybackRequiresUserAction={false}
      injectedJavaScript={injected}
      onMessage={handleMessage}
    />
  );
};
