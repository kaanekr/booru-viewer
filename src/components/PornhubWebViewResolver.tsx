import React, { useEffect, useMemo, useRef } from 'react';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { parsePornhubDetail } from '../services/pornhub';
import type { PornhubFiles } from '../services/pornhub';

interface Props {
  pageUrl: string;
  onResolve: (files: PornhubFiles | null) => void;
}

/**
 * Fallback when the Pornhub bot wall (JS proof-of-work) blocks RN fetch:
 * a hidden WebView with the real Safari engine solves the challenge itself,
 * then the `mediaDefinitions` block is posted to the RN side and converted
 * to HLS streams with the existing parser. Cookies persist in the WebView.
 */
export const PornhubWebViewResolver: React.FC<Props> = ({ pageUrl, onResolve }) => {
  const doneRef = useRef(false);
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;

  // If the page connection hangs, neither message nor error arrives: always
  // terminate the resolver with an absolute ceiling so the spinner never spins forever.
  useEffect(() => {
    doneRef.current = false;
    const t = setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onResolveRef.current(null);
      }
    }, 20000);
    return () => {
      doneRef.current = true;
      clearTimeout(t);
    };
  }, [pageUrl]);

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
          } else if (tries >= 15) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false, reason: 'nomedia:' + document.title }));
            clearInterval(timer);
          }
        } catch (e) {
          if (tries >= 15) {
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
        onResolveRef.current(null);
        return;
      }
      const files = parsePornhubDetail(data.chunk);
      doneRef.current = true;
      onResolveRef.current(files.high || files.hls || files.low ? files : null);
    } catch {
      doneRef.current = true;
      onResolveRef.current(null);
    }
  };

  const failFast = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onResolveRef.current(null);
  };

  // On Android onHttpError also fires for sub-resource (ad/tracker) errors;
  // give up only if the main page dies, otherwise the resolver dies needlessly
  // and the real video never arrives.
  const handleHttpError = (e: any) => {
    try {
      const failedUrl = String(e?.nativeEvent?.url || '');
      if (
        failedUrl &&
        failedUrl !== pageUrl &&
        !pageUrl.startsWith(failedUrl) &&
        !failedUrl.startsWith(pageUrl)
      ) {
        return;
      }
    } catch {}
    failFast();
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
      // If the page fails to load, don't wait for the 15s poll: tear down the heavy WebView immediately.
      onError={failFast}
      onHttpError={handleHttpError}
    />
  );
};
