import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Modal,
  View,
  ActivityIndicator,
  AppState,
  BackHandler,
  StyleSheet,
} from 'react-native';
import {WebView, WebViewMessageEvent} from 'react-native-webview';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {useWafStore, WafRequest} from '../lib/zustand/wafStore';
import {headers as commonHeaders} from '../lib/providers/headers';
import type {OpenWebViewResult} from '../lib/providers/types';
import {
  buildCookieString,
  getCookieObjects,
  getCookies,
  pickUserAgent,
} from '../lib/services/cookieManager';
import {updateGlobalCookies} from '../lib/services/cookieStore';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';
import TVTouchable from './tv/TVTouchable';

const GRAB_HTML_JS =
  '(function(){try{window.ReactNativeWebView.postMessage(JSON.stringify({__waf:true,html:document.documentElement.outerHTML}));}catch(e){}})(); true;';

const WafWebViewDialog = () => {
  const request = useWafStore(state => state.requests[0]);
  const remove = useWafStore(state => state.remove);
  const {primary, onPrimary} = useM3Colors();

  const [loading, setLoading] = useState(true);
  // Silent requests stay hidden until the page asks for a challenge. Keyed by
  // request id so a new silent request never renders visible for a frame.
  const [revealedId, setRevealedId] = useState<number | null>(null);
  const revealed =
    !!request && (!request.silent || revealedId === request.id);
  // A dialog can't appear while the app is in the background, and swapping
  // the hidden WebView into one there would stall every queued fetch until
  // the app is opened. So a reveal asked for in the background waits.
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [revealWanted, setRevealWanted] = useState<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state =>
      setAppActive(state === 'active'),
    );
    return () => sub.remove();
  }, []);
  const reveal = useCallback(() => {
    if (request) {
      setRevealWanted(request.id);
    }
  }, [request]);
  useEffect(() => {
    if (appActive && request && revealWanted === request.id) {
      setRevealedId(request.id);
    }
  }, [appActive, request, revealWanted]);
  const webViewRef = useRef<WebView>(null);
  // Guards against settling the same request more than once.
  const settledRef = useRef(false);
  // Latest captured page HTML.
  const htmlRef = useRef('');
  // Set while waiting for a fresh HTML capture before resolving.
  const pendingResolveRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialCookieValuesRef = useRef<Record<string, string>>({});
  const webViewReadyRef = useRef(false);

  const userAgent =
    pickUserAgent(request?.headers) || commonHeaders['User-Agent'];

  // Reset transient state whenever a new request becomes active.
  useEffect(() => {
    settledRef.current = false;
    pendingResolveRef.current = false;
    htmlRef.current = '';
    setLoading(true);
    webViewReadyRef.current = false;
    initialCookieValuesRef.current = {};
    let cancelled = false;

    // Snapshot existing cookies so we can detect new or updated cookies
    if (request) {
      (async () => {
        const cookieMap = await getCookies(request.url);
        if (!cancelled) {
          initialCookieValuesRef.current = cookieMap;
          webViewReadyRef.current = true;
        }
      })();
    }
  }, [request?.id]);

  // Resolve the active request with the captured page response + cookies.
  const finalizeResolve = useCallback(
    async (req: WafRequest) => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      try {
        const [cookieObjects, cookieMap] = await Promise.all([
          getCookieObjects(req.url),
          getCookies(req.url),
        ]);
        const cookies = buildCookieString(cookieMap);
        let expiresAt: number | null = null;
        if (req.waitForCookie) {
          const matched = cookieObjects.find(c => c.name === req.waitForCookie);
          if (matched?.expires) {
            const parsed = Date.parse(matched.expires);
            if (!isNaN(parsed)) {
              expiresAt = parsed;
            }
          }
        }
        if (cookies) {
          updateGlobalCookies(req.url, cookies, expiresAt);
        }
        const result: OpenWebViewResult = {
          data: htmlRef.current,
          cookies,
          cookieMap,
          url: req.url,
          userAgent,
          expires: expiresAt || undefined,
        };
        req.resolve(result);
      } catch (e) {
        req.reject(
          e instanceof Error ? e : new Error('Failed to read page response'),
        );
      } finally {
        remove(req.id);
      }
    },
    [remove, userAgent],
  );

  const cancel = useCallback(() => {
    if (!request || settledRef.current) {
      return;
    }
    settledRef.current = true;
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    request.reject(new Error('WAF_DIALOG_CANCELLED'));
    remove(request.id);
  }, [request, remove]);

  const resolveWithPage = useCallback(() => {
    if (!request || settledRef.current) {
      return;
    }
    settledRef.current = true;
    const req = request;
    pendingResolveRef.current = true;
    webViewRef.current?.injectJavaScript(GRAB_HTML_JS);
    fallbackTimerRef.current = setTimeout(() => {
      if (pendingResolveRef.current) {
        pendingResolveRef.current = false;
        finalizeResolve(req);
      }
    }, 1200);
  }, [request, finalizeResolve]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg && msg.__waf) {
          if (msg.challenge) {
            reveal();
            return;
          }
          if (msg.data !== undefined || msg.token !== undefined) {
            if (!settledRef.current && request) {
              settledRef.current = true;
              const payload = msg.data !== undefined ? msg.data : msg.token;
              htmlRef.current =
                typeof payload === 'string'
                  ? payload
                  : JSON.stringify(payload);
              finalizeResolve(request);
            }
            return;
          }
          if (typeof msg.html === 'string') {
            htmlRef.current = msg.html;
            if (pendingResolveRef.current && request) {
              pendingResolveRef.current = false;
              finalizeResolve(request);
            }
          }
        }
      } catch {}
    },
    [request, finalizeResolve, reveal],
  );

  useEffect(() => {
    const cookieName = request?.waitForCookie;
    const url = request?.url;
    if (!cookieName || !url) {
      return;
    }
    let cancelled = false;

    const poll = async () => {
      if (cancelled || settledRef.current || !webViewReadyRef.current) {
        return;
      }
      const cookieMap = await getCookies(url);
      const currentVal = cookieMap[cookieName];
      const initialVal = initialCookieValuesRef.current[cookieName];

      // Auto-resolve when the awaited cookie is newly set or updated
      if (currentVal && (!initialVal || currentVal !== initialVal)) {
        resolveWithPage();
      }
    };

    poll();
    const interval = setInterval(poll, 800);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [request?.id, request?.waitForCookie, request?.url, resolveWithPage]);

  // Hardware back button cancels the dialog (only while it is visible).
  useEffect(() => {
    if (!request || !revealed) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      cancel();
      return true;
    });
    return () => sub.remove();
  }, [request, cancel, revealed]);

  // A silent request that hasn't finished after a while probably needs the
  // user (a challenge the page script didn't recognise), so show it.
  useEffect(() => {
    if (!request?.silent || revealed || !appActive) {
      return;
    }
    const timer = setTimeout(reveal, 12000);
    return () => clearTimeout(timer);
  }, [request, revealed, reveal, appActive]);

  // Optional timeout cancels the dialog.
  useEffect(() => {
    if (!request?.timeoutMs) {
      return;
    }
    const timer = setTimeout(() => cancel(), request.timeoutMs);
    return () => clearTimeout(timer);
  }, [request, cancel]);

  if (!request) {
    return null;
  }

  const webView = (
    <WebView
      ref={webViewRef}
      source={{uri: request.url, headers: request.headers}}
      userAgent={userAgent}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      thirdPartyCookiesEnabled={true}
      sharedCookiesEnabled={true}
      injectedJavaScript={
        request.injectedJavaScript
          ? `${request.injectedJavaScript};\n${GRAB_HTML_JS}`
          : GRAB_HTML_JS
      }
      onMessage={onMessage}
      onLoadStart={() => setLoading(true)}
      onLoadEnd={() => {
        setLoading(false);
        if (request.injectedJavaScript) {
          webViewRef.current?.injectJavaScript(
            `${request.injectedJavaScript};\n true;`,
          );
        }
        webViewRef.current?.injectJavaScript(GRAB_HTML_JS);
      }}
    />
  );

  if (!revealed) {
    // Hidden: keep the WebView mounted and running, but invisible and
    // untouchable, so the app stays usable while it fetches.
    return (
      <View pointerEvents="none" style={styles.hidden}>
        {webView}
      </View>
    );
  }

  return (
    <Modal
      animationType="slide"
      visible={true}
      transparent={true}
      onRequestClose={cancel}>
      <View className="flex-1 bg-black/60 justify-center items-center p-4">
        <View
          className="bg-tertiary rounded-2xl overflow-hidden w-full"
          style={{height: '80%', maxWidth: 560}}>
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3">
            <View className="flex-1 pr-2">
              <AppText
                className="text-white text-base font-bold"
                numberOfLines={1}>
                {request.title || 'Verify you are human'}
              </AppText>
              <AppText className="text-white/60 text-xs" numberOfLines={2}>
                {request.description ||
                  'Complete the challenge below, then tap Done.'}
              </AppText>
            </View>
            <TVTouchable onPress={cancel} className="p-1">
              <MaterialIcons name="close" size={22} color="#c1c4c9" />
            </TVTouchable>
          </View>

          {/* WebView */}
          <View className="flex-1">
            {webView}
            {loading && (
              <View
                style={StyleSheet.absoluteFill}
                className="items-center justify-center bg-black/30">
                <ActivityIndicator size="large" color={primary} />
              </View>
            )}
          </View>

          {/* Footer */}
          <View className="flex-row items-center gap-3 px-4 py-3">
            <TVTouchable
              onPress={() => webViewRef.current?.reload()}
              className="px-4 py-2 rounded-md bg-white/10">
              <AppText className="text-white text-sm">Reload</AppText>
            </TVTouchable>
            <TVTouchable
              hasTVPreferredFocus
              onPress={resolveWithPage}
              className="flex-1 px-4 py-2 rounded-md items-center"
              style={{backgroundColor: primary}}>
              <AppText
                style={{color: onPrimary}}
                className="text-sm font-semibold">
                Done
              </AppText>
            </TVTouchable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
});

export default WafWebViewDialog;

