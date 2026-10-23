import AsyncStorage from '@react-native-async-storage/async-storage';
import * as KeepAwake from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { device } from './src/device';
import { isPdfUrl, browserDocumentUrl } from './src/navigation';
import { LoadingState } from './src/loading';
import { buildPageBridgeScript } from './src/pageBridge';
import { buildLoginFillScript, type LoginDetails } from './src/secureLogin';
import { SecureLoginContent } from './src/SecureLoginContent';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookMarked,
  BookOpen,
  CalendarDays,
  Check,
  Clock3,
  ExternalLink,
  Fingerprint,
  GraduationCap,
  History,
  Headphones,
  Info,
  Menu,
  MonitorPlay,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  AppState,
  FlatList,
  Image,
  Linking,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

const LMS_HOME_URL = 'https://lms.miva.university/my/courses.php';
const CALENDAR_URL = 'https://lms.miva.university/calendar/view.php?view=month';
const GRADES_URL = 'https://lms.miva.university/grade/report/overview/index.php';
const SUPPORT_URL = 'https://support.miva.university/';
const DEVELOPER_URL = 'https://conceptz.com.ng/?miva';
const YIKORA_URL = 'https://app.yikora.com/join/dfe';
const READINGKULTURE_URL = 'https://readingkulture.conceptz.com.ng/?miva';
const KEEP_AWAKE_TAG = 'miv-unofficial-lecture-mode';
const KEEP_AWAKE_RELEASE_TAGS = [KEEP_AWAKE_TAG, 'miva-unofficial-lecture-mode', KeepAwake.ExpoKeepAwakeTag];
const VIDEO_PREF_KEY = 'miv-unofficial.video-preferences.v1';
const KEEP_AWAKE_KEY = 'miv-unofficial.keep-awake.v1';
const LAST_URL_KEY = 'miv-unofficial.last-url.v1';
const RESUME_SESSION_KEY = 'miv-unofficial.resume-session.v1';
const REMINDER_KEY = 'miv-unofficial.learning-reminder.v1';
const REMINDER_CHANNEL_ID = 'learning-reminders-v2';
const REMINDER_SOUND_FILE = 'miv_reminder.wav';
const MIV_LOGO = require('./assets/miv-logo.png') as number;
type QualityPreference = 'auto' | '360' | '480' | '720' | '1080';

type VideoPreferences = {
  speed: number;
  quality: QualityPreference;
};

type ReminderSettings = {
  enabled: boolean;
  hour: number;
  minute: number;
  notificationId: string | null;
};
type DrawerItem = {
  label: string;
  url?: string;
  externalUrl?: string;
  Icon: typeof BookOpen;
  action?: 'settings' | 'misc';
};

type WebMessage =
  | {
      type: 'video-preferences-detected';
      speed?: number;
      quality?: QualityPreference;
      source?: 'html5' | 'vimeo';
      userInitiated?: boolean;
    }
  | {
      type: 'web-layer-ready';
    }
  | {
      type: 'pull-refresh';
    }
  | {
      type: 'open-pdf';
      url?: string;
    }
  | { type: 'navigation-start'; url?: string }
  | { type: 'video-state'; playing: boolean }
  | { type: 'login-filled'; ok: boolean };

const DEFAULT_VIDEO_PREFS: VideoPreferences = {
  speed: 1,
  quality: 'auto',
};

const DEFAULT_REMINDER: ReminderSettings = {
  enabled: false,
  hour: 20,
  minute: 0,
  notificationId: null,
};

const SPEED_OPTIONS = [1, 1.25, 1.5, 1.75, 2];
const QUALITY_OPTIONS: QualityPreference[] = ['auto', '360', '480', '720', '1080'];
const WEB_HOSTS = new Set([
  'lms.miva.university',
  'sis.miva.university',
  'cas.miva.university',
  'miva.university',
  'miva.edu.ng',
]);


const MAIN_DRAWER_ITEMS: DrawerItem[] = [
  {
    label: 'Home',
    url: LMS_HOME_URL,
    Icon: BookOpen,
  },
  {
    label: 'Calendar',
    url: CALENDAR_URL,
    Icon: CalendarDays,
  },
  {
    label: 'Grades',
    url: GRADES_URL,
    Icon: GraduationCap,
  },
  {
    label: 'Support',
    externalUrl: SUPPORT_URL,
    Icon: Headphones,
  },
  {
    label: 'Settings',
    Icon: Settings,
    action: 'settings',
  },
];

const TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const totalMinutes = index * 15;
  return {
    hour: Math.floor(totalMinutes / 60),
    minute: totalMinutes % 60,
  };
});

type TimeOption = (typeof TIME_OPTIONS)[number];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const buildWebEnhancementScript = (preferences: VideoPreferences, keepScreenAwake: boolean) => `
${buildPageBridgeScript()}
(function () {
  var preference = ${JSON.stringify(preferences)};
  var keepScreenAwake = ${JSON.stringify(keepScreenAwake)};

  if (window.MivaUnofficial && window.MivaUnofficial.setVideoPreferences) {
    window.MivaUnofficial.setVideoPreferences(preference);
    if (window.MivaUnofficial.setKeepScreenAwake) {
      window.MivaUnofficial.setKeepScreenAwake(keepScreenAwake);
    }
    true;
    return;
  }

  var pageWakeLockSentinel = null;
  var STYLE_ID = 'miv-unofficial-cleanup-style';
  var VIMEO_SCRIPT_SRC = 'https://player.vimeo.com/api/player.js';
  var CHAT_WIDGET_SELECTORS = [
    '#zs_fl_logo',
    '#zs-fl-tip',
    '#zs-tip-close',
    '#zsiq_chat_wrap',
    '.zsiq-float-tooltip',
    '.zs-fl-logo',
    '.chat-iframe-wrap',
    '.seasonal-cw-bg'
  ];
  var PULL_REFRESH_DISTANCE = 92;
  var vimeoScriptLoading = false;
  var vimeoScriptCallbacks = [];
  var lastMediaInteractionAt = 0;
  var pullStartX = null;
  var pullStartY = null;
  var pullRefreshArmed = false;
  var lastPullRefreshAt = 0;

  function postMessage(payload) {
    try {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (error) {}
  }

  function makeWakeLockError() {
    try {
      return new DOMException('Screen wake lock is disabled in Miv Unofficial.', 'NotAllowedError');
    } catch (error) {
      var fallback = new Error('Screen wake lock is disabled in Miv Unofficial.');
      fallback.name = 'NotAllowedError';
      return fallback;
    }
  }

  function releasePageWakeLock() {
    try {
      if (pageWakeLockSentinel && pageWakeLockSentinel.release) {
        pageWakeLockSentinel.release().catch(function () {});
      }
    } catch (error) {}
    pageWakeLockSentinel = null;
  }

  function installWakeLockGuard() {
    try {
      if (!navigator.wakeLock || navigator.wakeLock.mivaUnofficialGuarded) {
        return;
      }

      var originalRequest = navigator.wakeLock.request && navigator.wakeLock.request.bind(navigator.wakeLock);
      if (!originalRequest) {
        return;
      }

      Object.defineProperty(navigator.wakeLock, 'request', {
        configurable: true,
        value: function (type) {
          if (!keepScreenAwake && (!type || type === 'screen')) {
            return Promise.reject(makeWakeLockError());
          }

          return originalRequest.apply(navigator.wakeLock, arguments).then(function (sentinel) {
            if (!type || type === 'screen') {
              pageWakeLockSentinel = sentinel;
            }
            return sentinel;
          });
        }
      });

      navigator.wakeLock.mivaUnofficialGuarded = true;
    } catch (error) {}
  }

  function setKeepScreenAwake(nextValue) {
    keepScreenAwake = !!nextValue;
    if (!keepScreenAwake) {
      releasePageWakeLock();
    }
  }

  function hideChatWidget() {
    if (document.getElementById(STYLE_ID)) return;
    var parent = document.head || document.documentElement;
    if (!parent) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CHAT_WIDGET_SELECTORS.join(',') + '{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;}';
    parent.appendChild(style);
  }

  function getPageScrollTop() {
    return window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  function isEditableTarget(target) {
    try {
      return !!(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
    } catch (error) {
      return false;
    }
  }

  function resetPullRefresh() {
    pullStartX = null;
    pullStartY = null;
    pullRefreshArmed = false;
  }

  function installPullToRefreshBridge() {
    if (window.__mivUnofficialPullToRefreshInstalled) {
      return;
    }
    window.__mivUnofficialPullToRefreshInstalled = true;

    document.addEventListener('touchstart', function (event) {
      try {
        if (!event.touches || event.touches.length !== 1 || getPageScrollTop() > 2 || isEditableTarget(event.target)) {
          resetPullRefresh();
          return;
        }

        pullStartX = event.touches[0].clientX;
        pullStartY = event.touches[0].clientY;
        pullRefreshArmed = true;
      } catch (error) {
        resetPullRefresh();
      }
    }, { passive: true, capture: true });

    document.addEventListener('touchmove', function (event) {
      try {
        if (!pullRefreshArmed || !event.touches || event.touches.length !== 1 || pullStartY === null || pullStartX === null) {
          return;
        }

        if (getPageScrollTop() > 2) {
          resetPullRefresh();
          return;
        }

        var deltaY = event.touches[0].clientY - pullStartY;
        var deltaX = Math.abs(event.touches[0].clientX - pullStartX);
        var isMostlyVertical = deltaY > 0 && deltaX < deltaY * 0.55;
        var canRefresh = Date.now() - lastPullRefreshAt > 2500;

        if (isMostlyVertical && deltaY >= PULL_REFRESH_DISTANCE && canRefresh) {
          lastPullRefreshAt = Date.now();
          resetPullRefresh();
          postMessage({ type: 'pull-refresh' });
        }
      } catch (error) {
        resetPullRefresh();
      }
    }, { passive: true, capture: true });

    document.addEventListener('touchend', resetPullRefresh, { passive: true, capture: true });
    document.addEventListener('touchcancel', resetPullRefresh, { passive: true, capture: true });
  }


  function normaliseQuality(value) {
    var text = String(value || '').toLowerCase();
    if (text === 'auto') return 'auto';
    var match = text.match(/(360|480|720|1080)p?/);
    return match ? match[1] : undefined;
  }

  function reportHtmlVideoPreferences(video) {
    var speed = video && Number(video.playbackRate);
    postMessage({
      type: 'video-preferences-detected',
      source: 'html5',
      speed: Number.isFinite(speed) ? speed : undefined,
      quality: undefined,
      userInitiated: Date.now() - lastMediaInteractionAt < 6000
    });
  }

  function bindHtmlVideo(video) {
    if (!video || video.dataset.mivaUnofficialBound === 'true') {
      return;
    }

    video.dataset.mivaUnofficialBound = 'true';
    video.defaultPlaybackRate = preference.speed;
    video.playbackRate = preference.speed;
    video.addEventListener('ratechange', function () {
      reportHtmlVideoPreferences(video);
    });
    video.addEventListener('loadedmetadata', function () {
      video.defaultPlaybackRate = preference.speed;
      video.playbackRate = preference.speed;
    });
    reportHtmlVideoPreferences(video);
  }

  function ensureVimeoApi(callback) {
    if (window.Vimeo && window.Vimeo.Player) {
      callback();
      return;
    }

    if (!document.head) return;
    vimeoScriptCallbacks.push(callback);
    if (vimeoScriptLoading) {
      return;
    }

    vimeoScriptLoading = true;
    var script = document.createElement('script');
    script.src = VIMEO_SCRIPT_SRC;
    script.async = true;
    script.onload = function () {
      var callbacks = vimeoScriptCallbacks.slice();
      vimeoScriptCallbacks = [];
      callbacks.forEach(function (queuedCallback) {
        try {
          queuedCallback();
        } catch (error) {}
      });
    };
    script.onerror = function () {
      vimeoScriptCallbacks = [];
      vimeoScriptLoading = false;
    };
    document.head && document.head.appendChild(script);
  }

  function reportVimeoPreferences(player) {
    try {
      Promise.all([
        player.getPlaybackRate().catch(function () { return undefined; }),
        player.getQuality().catch(function () { return undefined; })
      ]).then(function (values) {
        var speed = Number(values[0]);
        postMessage({
          type: 'video-preferences-detected',
          source: 'vimeo',
          speed: Number.isFinite(speed) && speed > 0 ? speed : undefined,
          quality: normaliseQuality(values[1]),
          userInitiated: Date.now() - lastMediaInteractionAt < 6000
        });
      });
    } catch (error) {}
  }

  function closestNumber(values, target) {
    var closest;
    Array.prototype.forEach.call(values || [], function (value) {
      var number = Number(value);
      if (!Number.isFinite(number) || number <= 0) {
        return;
      }
      if (closest === undefined || Math.abs(number - target) < Math.abs(closest - target)) {
        closest = number;
      }
    });
    return closest;
  }

  function getVimeoQualityId(value) {
    if (!value) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    return value.id || value.quality || value.label || value.name;
  }

  function postVimeoCommand(iframe, method, value) {
    try {
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(JSON.stringify({ method: method, value: value }), 'https://player.vimeo.com');
      }
    } catch (error) {}
  }

  function applyVimeoSpeed(player, iframe) {
    if (!player || !player.setPlaybackRate) {
      return;
    }

    var target = Number(preference.speed);
    if (!Number.isFinite(target) || target <= 0) {
      return;
    }

    var setRate = function (rate) {
      if (target !== Number(preference.speed)) return;
      try {
        player.setPlaybackRate(rate).catch(function () {
          if (target !== Number(preference.speed)) return;
          postVimeoCommand(iframe, 'setPlaybackRate', rate);
        });
      } catch (error) {
        postVimeoCommand(iframe, 'setPlaybackRate', rate);
      }
    };

    if (player.getPlaybackRates) {
      player.getPlaybackRates().then(function (rates) {
        if (Array.isArray(rates) && rates.length > 0) {
          var selectedRate = rates.indexOf(target) >= 0 ? target : closestNumber(rates, target);
          if (selectedRate) {
            setRate(selectedRate);
          }
          return;
        }
        setRate(target);
      }).catch(function () {
        setRate(target);
      });
      return;
    }

    setRate(target);
  }

  function applyVimeoQuality(player, iframe) {
    if (!player || !player.setQuality) {
      return;
    }

    var target = preference.quality === 'auto' ? 'auto' : preference.quality + 'p';
    var setQuality = function (quality) {
      if (target !== (preference.quality === 'auto' ? 'auto' : preference.quality + 'p')) return;
      try {
        player.setQuality(quality).catch(function () {
          if (target !== (preference.quality === 'auto' ? 'auto' : preference.quality + 'p')) return;
          postVimeoCommand(iframe, 'setQuality', quality);
        });
      } catch (error) {
        postVimeoCommand(iframe, 'setQuality', quality);
      }
    };

    if (player.getQualities) {
      player.getQualities().then(function (qualities) {
        var selectedQuality;
        Array.prototype.forEach.call(qualities || [], function (quality) {
          var qualityId = getVimeoQualityId(quality);
          if (!selectedQuality && normaliseQuality(qualityId) === preference.quality) {
            selectedQuality = qualityId;
          }
        });
        setQuality(selectedQuality || target);
      }).catch(function () {
        setQuality(target);
      });
      return;
    }

    setQuality(target);
  }

  function applyRawVimeoPreferences(iframe) {
    var target = Number(preference.speed);
    if (Number.isFinite(target) && target > 0) {
      postVimeoCommand(iframe, 'setPlaybackRate', target);
    }
    postVimeoCommand(iframe, 'setQuality', preference.quality === 'auto' ? 'auto' : preference.quality + 'p');
  }

  function applyVimeoPreferences(player, iframe) {
    var signature = preference.speed + ':' + preference.quality;
    if (iframe.mivAppliedPreference === signature) return;
    iframe.mivAppliedPreference = signature;
    iframe.mivApplyingUntil = Date.now() + 1800;
    applyVimeoSpeed(player, iframe);
    applyVimeoQuality(player, iframe);
  }

  function bindVimeoIframe(iframe) {
    if (!iframe || iframe.dataset.mivaUnofficialVimeoBound === 'true') {
      return;
    }

    var src = String(iframe.src || iframe.getAttribute('src') || '');
    try { if (new URL(src, location.href).hostname !== 'player.vimeo.com') return; }
    catch (error) { return; }

    iframe.dataset.mivaUnofficialVimeoBound = 'true';
    iframe.addEventListener('load', function () {
      iframe.mivAppliedPreference = null;
      iframe.mivRawPreference = null;
      scheduleEnhancement();
    });
    var existingAllow = String(iframe.getAttribute('allow') || '');
    ['autoplay', 'fullscreen', 'picture-in-picture', 'encrypted-media'].forEach(function (permission) {
      if (existingAllow.indexOf(permission) < 0) {
        existingAllow += (existingAllow ? '; ' : '') + permission;
      }
    });
    iframe.setAttribute('allow', existingAllow);
    setTimeout(function () {
      applyRawVimeoPreferences(iframe);
    }, 1200);

    ensureVimeoApi(function () {
      try {
        var player = new window.Vimeo.Player(iframe);
        iframe.mivaUnofficialVimeoPlayer = player;
        player.ready().then(function () {
          applyVimeoPreferences(player, iframe);
          setTimeout(function () {
            reportVimeoPreferences(player);
          }, 800);
        }).catch(function () {});
        player.on('playbackratechange', function (data) {
          postMessage({
            type: 'video-preferences-detected',
            source: 'vimeo',
            speed: data && Number(data.playbackRate),
            userInitiated: Date.now() > (iframe.mivApplyingUntil || 0)
          });
        });
        player.on('qualitychange', function (data) {
          postMessage({
            type: 'video-preferences-detected',
            source: 'vimeo',
            quality: normaliseQuality(data && (data.quality || data.id)),
            userInitiated: Date.now() > (iframe.mivApplyingUntil || 0)
          });
        });
      } catch (error) {}
    });
  }

  function applyVideoPreferences() {
    hideChatWidget();

    Array.prototype.forEach.call(document.querySelectorAll('video'), function (video) {
      bindHtmlVideo(video);
      if (Math.abs(video.playbackRate - preference.speed) > 0.02) {
        video.defaultPlaybackRate = preference.speed;
        video.playbackRate = preference.speed;
      }
    });

    Array.prototype.forEach.call(document.querySelectorAll('iframe'), function (iframe) {
      bindVimeoIframe(iframe);
      if (iframe.mivaUnofficialVimeoPlayer) {
        applyVimeoPreferences(iframe.mivaUnofficialVimeoPlayer, iframe);
      } else if (iframe.dataset && iframe.dataset.mivaUnofficialVimeoBound === 'true') {
        var signature = preference.speed + ':' + preference.quality;
        if (iframe.mivRawPreference !== signature) {
          iframe.mivRawPreference = signature;
          applyRawVimeoPreferences(iframe);
        }
      }
    });
  }

  document.addEventListener('pointerdown', function (event) {
    try {
      var target = event.target;
      if (
        target &&
        target.closest &&
        target.closest('video, iframe, button, [role="button"], [role="menuitem"], [role="option"], .vjs-control-bar, .plyr, [class*="quality" i], [class*="speed" i], [aria-label*="quality" i], [aria-label*="speed" i]')
      ) {
        lastMediaInteractionAt = Date.now();
      }
    } catch (error) {}
  }, true);

  var enhancementScheduled = false;
  function scheduleEnhancement() {
    if (enhancementScheduled || document.hidden) return;
    enhancementScheduled = true;
    setTimeout(function () {
      enhancementScheduled = false;
      applyVideoPreferences();
    }, 100);
  }

  window.MivaUnofficial = {
    setVideoPreferences: function (nextPreference) {
      preference = Object.assign({}, preference, nextPreference || {});
      applyVideoPreferences();
    },
    setKeepScreenAwake: setKeepScreenAwake
  };

  installWakeLockGuard();
  installPullToRefreshBridge();
  setKeepScreenAwake(keepScreenAwake);
  applyVideoPreferences();
  setTimeout(applyVideoPreferences, 800);
  var enhancementObserver;
  function observeEnhancements() {
    if (enhancementObserver || !document.documentElement) return;
    enhancementObserver = new MutationObserver(scheduleEnhancement);
    enhancementObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    applyVideoPreferences();
  }
  observeEnhancements();
  document.addEventListener('DOMContentLoaded', observeEnhancements, { once: true });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleEnhancement(); });

  postMessage({ type: 'web-layer-ready' });
})();
true;
`;

const buildPreferenceUpdateScript = (preferences: VideoPreferences) => `
if (window.MivaUnofficial && window.MivaUnofficial.setVideoPreferences) {
  window.MivaUnofficial.setVideoPreferences(${JSON.stringify(preferences)});
}
true;
`;

const buildKeepAwakeUpdateScript = (enabled: boolean) => `
if (window.MivaUnofficial && window.MivaUnofficial.setKeepScreenAwake) {
  window.MivaUnofficial.setKeepScreenAwake(${JSON.stringify(enabled)});
}
true;
`;

const isFiniteSpeed = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.25 && value <= 4;
};

const isQualityPreference = (value: unknown): value is QualityPreference => {
  return value === 'auto' || value === '360' || value === '480' || value === '720' || value === '1080';
};

const formatSpeed = (speed: number) => {
  return speed % 1 === 0 ? `${speed.toFixed(0)}x` : `${speed}x`;
};

const formatQuality = (quality: QualityPreference) => {
  return quality === 'auto' ? 'Auto' : `${quality}p`;
};

const isAllowedWebUrl = (url: string) => {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    return parsedUrl.protocol === 'https:' && WEB_HOSTS.has(hostname);
  } catch (error) {
    return false;
  }
};

const parseIncomingUrl = (url: string) => {
  if (isAllowedWebUrl(url)) {
    return url;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'mivaunofficial:') {
      const nestedUrl = parsedUrl.searchParams.get('url');
      if (nestedUrl && isAllowedWebUrl(nestedUrl)) {
        return nestedUrl;
      }
    }
  } catch (error) {}

  return null;
};


type HapticKind = 'light' | 'medium' | 'selection' | 'success' | 'none';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const playHaptic = (kind: HapticKind = 'light') => {
  if (kind === 'none' || Platform.OS === 'web') {
    return;
  }

  if (kind === 'selection') {
    void Haptics.selectionAsync().catch(() => {});
    return;
  }

  if (kind === 'success') {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    return;
  }

  const style = kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light;
  void Haptics.impactAsync(style).catch(() => {});
};

type HapticPressableProps = React.ComponentProps<typeof Pressable> & {
  haptic?: HapticKind;
  pressScale?: number;
};

function HapticPressable({
  haptic = 'light',
  pressScale = 0.97,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  style,
  ...props
}: HapticPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = useCallback(
    (toValue: number) => {
      Animated.spring(scale, {
        toValue,
        speed: 28,
        bounciness: 8,
        useNativeDriver: true,
      }).start();
    },
    [scale]
  );

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPress={(event) => {
        if (!disabled) {
          playHaptic(haptic);
        }
        onPress?.(event);
      }}
      onPressIn={(event) => {
        if (!disabled) {
          animateTo(pressScale);
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animateTo(1);
        onPressOut?.(event);
      }}
      style={[style, { transform: [{ scale }] }] as never}
    />
  );
}
const releaseKeepAwakeLocks = async () => {
  await Promise.all(KEEP_AWAKE_RELEASE_TAGS.map((tag) => KeepAwake.deactivateKeepAwake(tag).catch(() => {})));
};

const formatReminderTime = (hour: number, minute: number) => {
  const date = new Date(2026, 0, 1, hour, minute);
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch (error) {
    const period = hour >= 12 ? 'PM' : 'AM';
    const normalizedHour = hour % 12 || 12;
    return `${normalizedHour}:${minute.toString().padStart(2, '0')} ${period}`;
  }
};

const ensureNotificationPermission = async () => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: 'Learning reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: REMINDER_SOUND_FILE,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.NOTIFICATION,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E3A325',
    });
  }

  const existingPermission = await Notifications.getPermissionsAsync();
  if (existingPermission.status === 'granted') {
    return true;
  }

  const requestedPermission = await Notifications.requestPermissionsAsync();
  return requestedPermission.status === 'granted';
};

const scheduleLearningReminder = async (settings: ReminderSettings) => {
  const hasPermission = await ensureNotificationPermission();
  if (!hasPermission) {
    throw new Error('Notifications are disabled for this app.');
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Time to learn',
      body: 'Open Miva LMS and keep your learning streak alive.',
      data: {
        url: LMS_HOME_URL,
      },
      sound: REMINDER_SOUND_FILE,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      channelId: REMINDER_CHANNEL_ID,
      hour: settings.hour,
      minute: settings.minute,
    },
  });
  if (settings.notificationId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(settings.notificationId);
    } catch (error) {
      await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => {});
      throw error;
    }
  }
  return notificationId;
};

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const lastUrlWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedUrlRef = useRef<string | null>(null);
  const [sourceUri, setSourceUri] = useState(LMS_HOME_URL);
  const [currentUrl, setCurrentUrl] = useState(LMS_HOME_URL);
  const currentUrlRef = useRef(LMS_HOME_URL);
  const loadingState = useRef(new LoadingState()).current;
  const secureLoginRequest = useRef(0);
  const browserOpeningRef = useRef(false);
  const resumeSessionRef = useRef(true);
  const awakeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0.04);
  const [pipActive, setPipActive] = useState(false);
  const [secureLoginOpen, setSecureLoginOpen] = useState(false);
  const [secureLoginAutoFill, setSecureLoginAutoFill] = useState(true);
  const progressAnimation = useRef(new Animated.Value(0.04)).current;
  const loadFinishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBrowserPdfRef = useRef({ url: '', at: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [miscOpen, setMiscOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [videoPreferences, setVideoPreferences] = useState<VideoPreferences>(DEFAULT_VIDEO_PREFS);
  const videoPreferencesRef = useRef(DEFAULT_VIDEO_PREFS);
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false);
  const [resumePreviousSession, setResumePreviousSession] = useState(true);
  const [reminder, setReminder] = useState<ReminderSettings>(DEFAULT_REMINDER);
  const reminderRef = useRef(DEFAULT_REMINDER);
  const reminderQueueRef = useRef<Promise<void>>(Promise.resolve());

  const injectedScript = useMemo(
    () => buildWebEnhancementScript(videoPreferences, keepAwakeEnabled),
    [keepAwakeEnabled, videoPreferences]
  );

  const beginNavigation = useCallback((url = currentUrlRef.current, force = false) => {
    const previous = loadingState.revision;
    loadingState.begin(url, force);
    if (loadFinishTimer.current) clearTimeout(loadFinishTimer.current);
    loadFinishTimer.current = null;
    if (previous !== loadingState.revision) {
      progressAnimation.stopAnimation();
      progressAnimation.setValue(0.04);
    }
    setLoadProgress(loadingState.progress);
    setIsLoading(true);
  }, [loadingState, progressAnimation]);

  const finishNavigation = useCallback((url = currentUrlRef.current) => {
    const revision = loadingState.complete(url);
    if (revision === null) return;
    if (loadFinishTimer.current) clearTimeout(loadFinishTimer.current);
    setLoadProgress(1);
    setIsRefreshing(false);
    loadFinishTimer.current = setTimeout(() => {
      loadFinishTimer.current = null;
      if (loadingState.hide(revision)) setIsLoading(false);
    }, 200);
  }, [loadingState]);

  const openPdfInBrowser = useCallback(async (url: string) => {
    const browserUrl = browserDocumentUrl(url);
    if (!browserUrl || browserOpeningRef.current) return;
    const previous = lastBrowserPdfRef.current;
    if (previous.url === browserUrl && Date.now() - previous.at < 1500) return;
    lastBrowserPdfRef.current = { url: browserUrl, at: Date.now() };
    browserOpeningRef.current = true;
    try {
      await WebBrowser.openBrowserAsync(browserUrl);
    } catch {
      Alert.alert('Browser unavailable', 'Install or enable a web browser to open this document.');
    } finally {
      browserOpeningRef.current = false;
    }
  }, []);

  const closeSecureLogin = useCallback(() => {
    secureLoginRequest.current += 1;
    setSecureLoginOpen(false);
    void device?.setBlocked(false);
  }, []);

  const openSecureLogin = useCallback(async (autoFill: boolean) => {
    const request = ++secureLoginRequest.current;
    await device?.setBlocked(true);
    if (request !== secureLoginRequest.current) return;
    if (AppState.currentState !== 'active') {
      void device?.setBlocked(false);
      return;
    }
    setDrawerOpen(false);
    setSecureLoginAutoFill(autoFill);
    setSecureLoginOpen(true);
  }, []);

  const fillLogin = useCallback((details: LoginDetails) => {
    closeSecureLogin();
    webViewRef.current?.injectJavaScript(buildLoginFillScript(details));
  }, [closeSecureLogin]);

  useEffect(() => {
    Animated.timing(progressAnimation, {
      toValue: loadProgress,
      duration: loadProgress === 1 ? 160 : 220,
      useNativeDriver: false,
    }).start();
  }, [loadProgress, progressAnimation]);

  useEffect(() => {
    const pipListener = device?.addListener('pipChanged', ({ active }) => {
      setPipActive(active);
      if (active) {
        setDrawerOpen(false); setSettingsOpen(false); setMiscOpen(false); setTimePickerOpen(false);
      }
    });
    const downloadListener = device?.addListener('download', ({ url }) => {
      finishNavigation(url);
      void openPdfInBrowser(url);
    });
    return () => {
      pipListener?.remove();
      downloadListener?.remove();
      void device?.setVideoPlaying(false);
      if (loadFinishTimer.current) clearTimeout(loadFinishTimer.current);
    };
  }, [finishNavigation, openPdfInBrowser]);

  const persistLastUrl = useCallback((url: string) => {
    const supportedUrl = parseIncomingUrl(url);
    if (!resumeSessionRef.current || !supportedUrl || isPdfUrl(supportedUrl) || supportedUrl === lastPersistedUrlRef.current) {
      return;
    }

    lastPersistedUrlRef.current = supportedUrl;
    if (lastUrlWriteTimerRef.current) {
      clearTimeout(lastUrlWriteTimerRef.current);
    }

    lastUrlWriteTimerRef.current = setTimeout(() => {
      void AsyncStorage.setItem(LAST_URL_KEY, supportedUrl).catch(() => {});
    }, 350);
  }, []);

  const navigateInApp = useCallback(
    (url: string) => {
      setDrawerOpen(false);
      if (isPdfUrl(url)) { void openPdfInBrowser(url); return; }
      beginNavigation(url, true);
      if (url === currentUrlRef.current) webViewRef.current?.reload();
      else if (url === sourceUri) webViewRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(url)}); true;`);
      else setSourceUri(url);
      currentUrlRef.current = url;
      setCurrentUrl(url);
      persistLastUrl(url);
    },
    [beginNavigation, openPdfInBrowser, persistLastUrl, sourceUri]
  );

  const openExternal = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => Alert.alert('Unable to open link', 'No installed app could open this link.'));
  }, []);

  const updateKeepAwakePreference = useCallback((enabled: boolean) => {
    setKeepAwakeEnabled(enabled);
  }, []);

  const updateResumePreviousSession = useCallback((enabled: boolean) => {
    resumeSessionRef.current = enabled;
    setResumePreviousSession(enabled);
    void AsyncStorage.setItem(RESUME_SESSION_KEY, String(enabled)).catch(() => {});
    if (!enabled) {
      if (lastUrlWriteTimerRef.current) clearTimeout(lastUrlWriteTimerRef.current);
      lastPersistedUrlRef.current = LMS_HOME_URL;
      void AsyncStorage.setItem(LAST_URL_KEY, LMS_HOME_URL).catch(() => {});
    }
  }, []);

  const persistVideoPreferences = useCallback(async (nextPreferences: VideoPreferences) => {
    videoPreferencesRef.current = nextPreferences;
    setVideoPreferences(nextPreferences);
    webViewRef.current?.injectJavaScript(buildPreferenceUpdateScript(nextPreferences));
    await AsyncStorage.setItem(VIDEO_PREF_KEY, JSON.stringify(nextPreferences));
  }, []);

  const persistReminder = useCallback(async (nextReminder: ReminderSettings) => {
    reminderRef.current = nextReminder;
    setReminder(nextReminder);
    await AsyncStorage.setItem(REMINDER_KEY, JSON.stringify(nextReminder));
  }, []);

  const updateReminder = useCallback((changes: Partial<Pick<ReminderSettings, 'enabled' | 'hour' | 'minute'>>, errorTitle: string) => {
    const task = reminderQueueRef.current.then(async () => {
      const next = { ...reminderRef.current, ...changes };
      if (next.enabled) next.notificationId = await scheduleLearningReminder(next);
      else {
        if (next.notificationId) await Notifications.cancelScheduledNotificationAsync(next.notificationId);
        next.notificationId = null;
      }
      await persistReminder(next);
    });
    reminderQueueRef.current = task.catch((error) => {
      Alert.alert(errorTitle, error instanceof Error ? error.message : 'Notifications are unavailable.');
    });
    return reminderQueueRef.current;
  }, [persistReminder]);

  const toggleReminder = useCallback((enabled: boolean) => updateReminder({ enabled }, 'Reminder not updated'), [updateReminder]);

  const setReminderTime = useCallback(
    (hour: number, minute: number) => {
      setTimePickerOpen(false);
      return updateReminder({ hour, minute }, 'Reminder not updated');
    },
    [updateReminder]
  );

  const sendTestNotification = useCallback(async () => {
    try {
      const hasPermission = await ensureNotificationPermission();
      if (!hasPermission) {
        Alert.alert('Notifications disabled', 'Allow notifications to receive learning reminders.');
        return;
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Miva learning reminder',
          body: 'Your reminder is working. Time to open your course.',
          data: {
            url: LMS_HOME_URL,
          },
          sound: REMINDER_SOUND_FILE,
        },
        trigger: {
          channelId: REMINDER_CHANNEL_ID,
        },
      });
    } catch (error) {
      Alert.alert('Test failed', error instanceof Error ? error.message : 'Could not send a test notification.');
    }
  }, []);

  useEffect(() => {
    void releaseKeepAwakeLocks();

    return () => {
      void awakeQueueRef.current.then(releaseKeepAwakeLocks).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const [
          storedVideoPreferences,
          storedKeepAwake,
          storedResumePreviousSession,
          storedReminder,
          storedLastUrl,
          initialUrl,
        ] = await Promise.all([
          AsyncStorage.getItem(VIDEO_PREF_KEY),
          AsyncStorage.getItem(KEEP_AWAKE_KEY),
          AsyncStorage.getItem(RESUME_SESSION_KEY),
          AsyncStorage.getItem(REMINDER_KEY),
          AsyncStorage.getItem(LAST_URL_KEY),
          Linking.getInitialURL(),
        ]);

        const shouldResumePreviousSession = storedResumePreviousSession !== 'false';
        setResumePreviousSession(shouldResumePreviousSession);
        resumeSessionRef.current = shouldResumePreviousSession;

        const initialSupportedUrl = initialUrl ? parseIncomingUrl(initialUrl) : null;
        const storedSupportedUrl = storedLastUrl ? parseIncomingUrl(storedLastUrl) : null;
        const resumeUrl = initialSupportedUrl || (shouldResumePreviousSession ? storedSupportedUrl : null) || LMS_HOME_URL;
        lastPersistedUrlRef.current = storedSupportedUrl;
        if (isPdfUrl(resumeUrl)) {
          void openPdfInBrowser(resumeUrl);
          lastPersistedUrlRef.current = LMS_HOME_URL;
          void AsyncStorage.setItem(LAST_URL_KEY, LMS_HOME_URL).catch(() => {});
          setSourceUri(LMS_HOME_URL);
        } else if (currentUrlRef.current === LMS_HOME_URL) {
          setSourceUri(resumeUrl);
          currentUrlRef.current = resumeUrl;
          setCurrentUrl(resumeUrl);
        }

        if (initialSupportedUrl && !isPdfUrl(initialSupportedUrl) && initialSupportedUrl !== storedSupportedUrl) {
          lastPersistedUrlRef.current = initialSupportedUrl;
          void AsyncStorage.setItem(LAST_URL_KEY, initialSupportedUrl).catch(() => {});
        }

        if (storedVideoPreferences) {
          try {
            const parsed = JSON.parse(storedVideoPreferences) as Partial<VideoPreferences>;
            if (isFiniteSpeed(parsed.speed) && isQualityPreference(parsed.quality)) {
              const stored = { speed: parsed.speed, quality: parsed.quality };
              videoPreferencesRef.current = stored;
              setVideoPreferences(stored);
            }
          } catch (error) {}
        }

        if (storedKeepAwake) {
          setKeepAwakeEnabled(storedKeepAwake === 'true');
        }

        if (storedReminder) {
          try {
            const parsed = JSON.parse(storedReminder) as Partial<ReminderSettings>;
            if (
              typeof parsed.enabled === 'boolean' &&
              typeof parsed.hour === 'number' &&
              parsed.hour >= 0 &&
              parsed.hour <= 23 &&
              typeof parsed.minute === 'number' &&
              parsed.minute >= 0 &&
              parsed.minute <= 59
            ) {
              const restoredReminder = {
                enabled: parsed.enabled,
                hour: parsed.hour,
                minute: parsed.minute,
                notificationId: typeof parsed.notificationId === 'string' ? parsed.notificationId : null,
              };
              reminderRef.current = restoredReminder;
              setReminder(restoredReminder);
            }
          } catch (error) {}
        }
      } catch {
        // Storage/link failures must not prevent the LMS from opening.
      } finally {
        setIsHydrated(true);
      }
    };

    void hydrate();
  }, [openPdfInBrowser]);

  useEffect(() => {
    if (!isHydrated) {
      return undefined;
    }

    const next = awakeQueueRef.current.catch(() => {}).then(async () => {
      if (keepAwakeEnabled) await KeepAwake.activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      else await releaseKeepAwakeLocks();
      webViewRef.current?.injectJavaScript(buildKeepAwakeUpdateScript(keepAwakeEnabled));
      await AsyncStorage.setItem(KEEP_AWAKE_KEY, String(keepAwakeEnabled));
    });
    awakeQueueRef.current = next.catch(() => {});
  }, [isHydrated, keepAwakeEnabled]);

  useEffect(() => {
    const flushPage = () => {
      const url = currentUrlRef.current;
      if (lastUrlWriteTimerRef.current) clearTimeout(lastUrlWriteTimerRef.current);
      if (resumeSessionRef.current && isAllowedWebUrl(url) && !isPdfUrl(url)) {
        void AsyncStorage.setItem(LAST_URL_KEY, url).catch(() => {});
      }
    };
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'background') { closeSecureLogin(); flushPage(); }
    });
    return () => { listener.remove(); flushPage(); };
  }, [closeSecureLogin]);

  useEffect(() => {
    const openSupportedUrl = (url: string | null | undefined) => {
      if (!url) {
        return;
      }

      const supportedUrl = parseIncomingUrl(url);
      if (supportedUrl) {
        navigateInApp(supportedUrl);
      }
    };

    const urlSubscription = Linking.addEventListener('url', (event) => {
      openSupportedUrl(event.url);
    });

    const notificationSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      openSupportedUrl(typeof url === 'string' ? url : LMS_HOME_URL);
    });

    return () => {
      urlSubscription.remove();
      notificationSubscription.remove();
    };
  }, [navigateInApp]);

  useEffect(() => {
    return () => {
      if (lastUrlWriteTimerRef.current) {
        clearTimeout(lastUrlWriteTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }

      if (secureLoginOpen) { closeSecureLogin(); return true; }

      if (timePickerOpen) {
        setTimePickerOpen(false);
        return true;
      }

      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }

      if (miscOpen) {
        setMiscOpen(false);
        return true;
      }

      if (canGoBack) {
        beginNavigation();
        webViewRef.current?.goBack();
        return true;
      }

      return false;
    });

    return () => subscription.remove();
  }, [beginNavigation, canGoBack, closeSecureLogin, drawerOpen, miscOpen, secureLoginOpen, settingsOpen, timePickerOpen]);

  const onNavigationStateChange = useCallback(
    (navigationState: WebViewNavigation) => {
      setCanGoBack(navigationState.canGoBack);
      setCanGoForward(navigationState.canGoForward);

      const supportedUrl = parseIncomingUrl(navigationState.url);
      if (supportedUrl && !isPdfUrl(supportedUrl)) {
        if (loadingState.loading && loadingState.url && supportedUrl.split('#')[0] !== loadingState.url.split('#')[0]) return;
        currentUrlRef.current = supportedUrl;
        setCurrentUrl(supportedUrl);
        persistLastUrl(supportedUrl);
      }
    },
    [loadingState, persistLastUrl]
  );

  const refreshWebView = useCallback(() => {
    if (!webViewRef.current) return;
    playHaptic('medium');
    beginNavigation(currentUrlRef.current, true);
    setIsRefreshing(true);
    webViewRef.current.reload();
  }, [beginNavigation]);

  const handleLoadStart = useCallback((event: { nativeEvent: { url: string } }) => {
    beginNavigation(event.nativeEvent.url);
    void device?.setVideoPlaying(false);
    void device?.attach();
  }, [beginNavigation]);

  const handleLoadEnd = useCallback((event: { nativeEvent: { url: string } }) => {
    finishNavigation(event.nativeEvent.url);
    void device?.attach();
  }, [finishNavigation]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      if (!isAllowedWebUrl(event.nativeEvent.url)) return;
      const message = JSON.parse(event.nativeEvent.data) as WebMessage;

      if (message.type === 'pull-refresh') {
        refreshWebView();
        return;
      }

      if (message.type === 'open-pdf' && message.url) {
        void openPdfInBrowser(message.url);
        return;
      }

      if (message.type === 'video-state' && typeof message.playing === 'boolean') {
        if (isAllowedWebUrl(event.nativeEvent.url)) void device?.setVideoPlaying(message.playing);
        return;
      }

      if (message.type === 'navigation-start' && message.url) {
        if (typeof message.url === 'string' && isAllowedWebUrl(message.url) && !isPdfUrl(message.url)) beginNavigation(message.url);
        return;
      }

      if (message.type === 'login-filled') {
        if (!message.ok) Alert.alert('Open the LMS login page', 'Secure Login fills the Miva LMS sign-in form. Open that page and try again.');
        return;
      }

      if (message.type === 'video-preferences-detected') {
        const current = videoPreferencesRef.current;
        if (!message.userInitiated) return;
        const next = {
          speed: isFiniteSpeed(message.speed) ? message.speed : current.speed,
          quality: isQualityPreference(message.quality) ? message.quality : current.quality,
        };
        if (next.speed !== current.speed || next.quality !== current.quality) {
          void persistVideoPreferences(next).catch(() => {});
        }
      }
    } catch (error) {}
  }, [beginNavigation, openPdfInBrowser, persistVideoPreferences, refreshWebView]);

  const setSpeed = useCallback(
    (speed: number) => {
      void persistVideoPreferences({ ...videoPreferencesRef.current, speed }).catch(() => {});
    },
    [persistVideoPreferences]
  );

  const setQuality = useCallback(
    (quality: QualityPreference) => {
      void persistVideoPreferences({ ...videoPreferencesRef.current, quality }).catch(() => {});
    },
    [persistVideoPreferences]
  );

  const openInBrowser = useCallback(() => {
    openExternal(currentUrlRef.current);
  }, [openExternal]);

  const onOpenWindow = useCallback(
    (event: { nativeEvent: { targetUrl: string } }) => {
      const targetUrl = event.nativeEvent.targetUrl;
      if (!targetUrl) return;
      if (isPdfUrl(targetUrl)) { void openPdfInBrowser(targetUrl); return; }
      if (isAllowedWebUrl(targetUrl)) { navigateInApp(targetUrl); return; }
      openExternal(targetUrl);
    },
    [navigateInApp, openExternal, openPdfInBrowser]
  );

  const onShouldStartLoadWithRequest = useCallback(
    (request: { url: string; isTopFrame?: boolean }) => {
      const url = request.url;
      if (isPdfUrl(url)) { void openPdfInBrowser(url); return false; }
      if (/^(about:|data:|blob:)/.test(url)) return true;
      if (request.isTopFrame === false && /^https?:/.test(url)) return true;
      if (isAllowedWebUrl(url)) {
        if (url.includes('#') && url.split('#')[0] === currentUrlRef.current.split('#')[0]) return true;
        beginNavigation(url);
        return true;
      }
      openExternal(url);
      return false;
    },
    [beginNavigation, openExternal, openPdfInBrowser]
  );

  const renderError = useCallback(
    () => (
      <View style={styles.errorState}>
        <ShieldCheck color="#E3A325" size={32} strokeWidth={2.2} />
        <Text style={styles.errorTitle}>LMS did not load</Text>
        <Text style={styles.errorUrl} numberOfLines={2}>
          {currentUrl}
        </Text>
        <View style={styles.errorActions}>
          <HapticPressable style={styles.primaryButton} haptic="medium" onPress={refreshWebView}>
            <RefreshCcw color="#FFFFFF" size={18} strokeWidth={2.4} />
            <Text style={styles.primaryButtonText}>Retry</Text>
          </HapticPressable>
          <HapticPressable style={styles.secondaryButton} onPress={openInBrowser}>
            <Text style={styles.secondaryButtonText}>Browser</Text>
          </HapticPressable>
        </View>
      </View>
    ),
    [currentUrl, openInBrowser, refreshWebView]
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.appShell} edges={pipActive ? [] : ['top', 'right', 'bottom', 'left']}>
      <StatusBar hidden={pipActive} barStyle="light-content" backgroundColor="#151B17" />

      <View style={[styles.header, pipActive && { display: 'none' }]}>
        <View style={styles.brandLockup}>
          <View style={styles.brandMark}>
            <Image source={MIV_LOGO} style={styles.brandLogo} resizeMode="contain" />
          </View>
          <View style={styles.brandTextBlock}>
            <Text style={styles.brandName}>Miv</Text>
            <Text style={styles.brandSubname}>Unofficial</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <RoundIconButton disabled={!canGoBack} Icon={ArrowLeft} onPress={() => { beginNavigation(); webViewRef.current?.goBack(); }} />
          <RoundIconButton disabled={!canGoForward} Icon={ArrowRight} onPress={() => { beginNavigation(); webViewRef.current?.goForward(); }} />
          <RoundIconButton Icon={Menu} onPress={() => setDrawerOpen(true)} variant="dark" />
        </View>
      </View>

      {isLoading && !pipActive ? (
        <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(loadProgress * 100) }}>
          <Animated.View style={[styles.progressFill, { width: progressAnimation.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
        </View>
      ) : null}

      <View style={styles.webSurface}>
        {isHydrated ? (
        <WebView
          ref={webViewRef}
          onLayout={() => void device?.attach()}
          source={{ uri: sourceUri }}
          style={styles.webView}
          originWhitelist={['http://*', 'https://*', 'mivaunofficial://*']}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          cacheEnabled
          incognito={false}
          cacheMode="LOAD_DEFAULT"
          saveFormDataDisabled={false}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          allowsPictureInPictureMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          pullToRefreshEnabled
          overScrollMode="always"
          injectedJavaScript={injectedScript}
          injectedJavaScriptBeforeContentLoaded={injectedScript}
          onLoadStart={handleLoadStart}
          onLoadEnd={handleLoadEnd}
          onLoadProgress={(event) => {
            setLoadProgress(loadingState.advance(event.nativeEvent.url, event.nativeEvent.progress));
          }}
          onNavigationStateChange={onNavigationStateChange}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onOpenWindow={onOpenWindow}
          onFileDownload={(event) => {
            finishNavigation(event.nativeEvent.downloadUrl);
            void openPdfInBrowser(event.nativeEvent.downloadUrl);
          }}
          renderError={renderError}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#E3A325" size="large" />
            </View>
          )}
        />
        ) : (
          <View style={styles.loadingState}>
            <ActivityIndicator color="#E3A325" size="large" />
          </View>
        )}
        {isRefreshing ? (
          <View pointerEvents="none" style={styles.refreshBubble}>
            <ActivityIndicator color="#E3A325" size="small" />
            <Text style={styles.refreshBubbleText}>Refreshing</Text>
          </View>
        ) : null}
      </View>

      <RightDrawer
        open={drawerOpen}
        currentUrl={currentUrl}
        onClose={() => setDrawerOpen(false)}
        onNavigate={navigateInApp}
        onOpenExternal={openExternal}
        onOpenSecureLogin={() => void openSecureLogin(true)}
        onManageSecureLogin={() => void openSecureLogin(false)}
        onOpenSettings={() => {
          setDrawerOpen(false);
          setSettingsOpen(true);
        }}
        onOpenMisc={() => {
          setDrawerOpen(false);
          setMiscOpen(true);
        }}
      />

      <Sheet visible={secureLoginOpen} title="Secure Login" onClose={closeSecureLogin} immediateClose>
        {secureLoginOpen ? <SecureLoginContent autoFill={secureLoginAutoFill} onFill={fillLogin} onClose={closeSecureLogin} /> : null}
      </Sheet>

      <SettingsPanel
        open={settingsOpen}
        keepAwakeEnabled={keepAwakeEnabled}
        preferences={videoPreferences}
        reminder={reminder}
        onClose={() => setSettingsOpen(false)}
        onKeepAwakeChange={updateKeepAwakePreference}
        resumePreviousSession={resumePreviousSession}
        onResumePreviousSessionChange={updateResumePreviousSession}
        onSpeedChange={setSpeed}
        onQualityChange={setQuality}
        onReminderToggle={toggleReminder}
        onOpenTimePicker={() => setTimePickerOpen(true)}
        onSendTestNotification={sendTestNotification}
      />

      <TimePickerPanel
        open={timePickerOpen}
        reminder={reminder}
        onClose={() => setTimePickerOpen(false)}
        onSelectTime={setReminderTime}
      />

      <MiscPanel
        open={miscOpen}
        onClose={() => setMiscOpen(false)}
        onOpenDeveloper={() => openExternal(DEVELOPER_URL)}
        onOpenYikora={() => openExternal(YIKORA_URL)}
        onOpenReadingKulture={() => openExternal(READINGKULTURE_URL)}
      />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function RightDrawer({
  open,
  currentUrl,
  onClose,
  onNavigate,
  onOpenExternal,
  onOpenSettings,
  onOpenMisc,
  onOpenSecureLogin,
  onManageSecureLogin,
}: {
  open: boolean;
  currentUrl: string;
  onClose: () => void;
  onNavigate: (url: string) => void;
  onOpenExternal: (url: string) => void;
  onOpenSettings: () => void;
  onOpenMisc: () => void;
  onOpenSecureLogin: () => void;
  onManageSecureLogin: () => void;
}) {
  const insets = useSafeAreaInsets();
  const drawerTranslateX = useRef(new Animated.Value(360)).current;

  useEffect(() => {
    if (!open) {
      return;
    }

    drawerTranslateX.setValue(360);
    Animated.spring(drawerTranslateX, {
      toValue: 0,
      speed: 22,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  }, [drawerTranslateX, open]);

  const closeDrawer = useCallback(() => {
    Animated.timing(drawerTranslateX, {
      toValue: 360,
      duration: 170,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [drawerTranslateX, onClose]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={closeDrawer}>
      <View style={styles.drawerScrim}>
        <HapticPressable style={StyleSheet.absoluteFill} pressScale={1} haptic="selection" onPress={closeDrawer} />
        <Animated.View
          style={[
            styles.drawer,
            { paddingTop: Math.max(insets.top + 10, 14), paddingBottom: Math.max(insets.bottom + 20, 20) },
            { transform: [{ translateX: drawerTranslateX }] },
          ]}
        >
          <View style={styles.drawerHeader}>
            <View style={styles.drawerBrandRow}>
              <View style={styles.drawerLogoFrame}>
                <Image source={MIV_LOGO} style={styles.drawerLogo} resizeMode="contain" />
              </View>
              <View style={styles.drawerTitleBlock}>
                <Text style={styles.drawerTitle}>Miv Unofficial</Text>
                <Text style={styles.drawerSubtitle}>Learning shortcuts</Text>
              </View>
            </View>
            <HapticPressable style={styles.drawerCloseButton} haptic="selection" onPress={closeDrawer}>
              <X color="#DDE8DF" size={21} strokeWidth={2.4} />
            </HapticPressable>
          </View>

          <View style={styles.drawerMenu}>
            {MAIN_DRAWER_ITEMS.map((item) => {
              const selected = item.url === currentUrl;
              return (
                <DrawerMenuButton
                  key={item.label}
                  item={item}
                  selected={selected}
                  onPress={() => {
                    if (item.action === 'settings') {
                      onOpenSettings();
                      return;
                    }

                    if (item.externalUrl) {
                      onOpenExternal(item.externalUrl);
                      closeDrawer();
                      return;
                    }

                    if (item.url) {
                      onNavigate(item.url);
                    }
                  }}
                />
              );
            })}
          </View>

          <View style={styles.drawerBottom}>
            <DrawerMenuButton
              item={{
                label: 'Misc',
                Icon: Info,
                action: 'misc',
              }}
              onPress={onOpenMisc}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <DrawerMenuButton item={{ label: 'Secure Login', Icon: Fingerprint }} onPress={onOpenSecureLogin} />
              </View>
              <HapticPressable style={styles.drawerCloseButton} accessibilityLabel="Manage saved login" onPress={onManageSecureLogin}>
                <Settings size={20} color="#FFFFFF" />
              </HapticPressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DrawerMenuButton({
  item,
  selected,
  onPress,
}: {
  item: DrawerItem;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <HapticPressable style={[styles.drawerItem, selected && styles.drawerItemSelected]} haptic="selection" onPress={onPress}>
      <View style={[styles.drawerItemIcon, selected && styles.drawerItemIconSelected]}>
        <item.Icon color={selected ? '#FFFFFF' : '#151B17'} size={20} strokeWidth={2.4} />
      </View>
      <Text style={[styles.drawerItemText, selected && styles.drawerItemTextSelected]}>{item.label}</Text>
    </HapticPressable>
  );
}

function RoundIconButton({
  disabled,
  Icon,
  onPress,
  variant = 'light',
}: {
  disabled?: boolean;
  Icon: typeof Menu;
  onPress: () => void;
  variant?: 'light' | 'dark';
}) {
  const isDark = variant === 'dark';
  const iconTwist = useRef(new Animated.Value(0)).current;
  const iconRotation = iconTwist.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', isDark ? '-16deg' : '-8deg'],
  });

  const handlePress = useCallback(() => {
    Animated.sequence([
      Animated.spring(iconTwist, {
        toValue: 1,
        speed: 36,
        bounciness: 12,
        useNativeDriver: true,
      }),
      Animated.spring(iconTwist, {
        toValue: 0,
        speed: 28,
        bounciness: 9,
        useNativeDriver: true,
      }),
    ]).start();
    onPress();
  }, [iconTwist, onPress]);

  return (
    <HapticPressable
      disabled={disabled}
      style={[
        styles.roundIconButton,
        isDark && styles.roundIconButtonDark,
        disabled && styles.roundIconButtonDisabled,
      ]}
      haptic={isDark ? 'medium' : 'light'}
      pressScale={0.92}
      onPress={handlePress}
    >
      <Animated.View style={{ transform: [{ rotate: iconRotation }] }}>
        <Icon color={disabled ? '#44524A' : isDark ? '#FFFFFF' : '#151B17'} size={20} strokeWidth={2.4} />
      </Animated.View>
    </HapticPressable>
  );
}

function SettingsPanel({
  open,
  keepAwakeEnabled,
  resumePreviousSession,
  preferences,
  reminder,
  onClose,
  onKeepAwakeChange,
  onResumePreviousSessionChange,
  onSpeedChange,
  onQualityChange,
  onReminderToggle,
  onOpenTimePicker,
  onSendTestNotification,
}: {
  open: boolean;
  keepAwakeEnabled: boolean;
  resumePreviousSession: boolean;
  preferences: VideoPreferences;
  reminder: ReminderSettings;
  onClose: () => void;
  onKeepAwakeChange: (enabled: boolean) => void;
  onResumePreviousSessionChange: (enabled: boolean) => void;
  onSpeedChange: (speed: number) => void;
  onQualityChange: (quality: QualityPreference) => void;
  onReminderToggle: (enabled: boolean) => void;
  onOpenTimePicker: () => void;
  onSendTestNotification: () => void;
}) {
  return (
    <Sheet visible={open} title="Settings" onClose={onClose}>
      <View style={styles.settingCard}>
        <View style={styles.settingRow}>
          <View style={styles.settingTextBlock}>
            <View style={styles.settingTitleRow}>
              <Sun color="#E3A325" size={18} strokeWidth={2.4} />
              <Text style={styles.settingTitle}>Keep screen awake</Text>
            </View>
            <Text style={styles.settingCaption}>Prevent the phone from sleeping during lectures.</Text>
          </View>
          <Switch
            value={keepAwakeEnabled}
            onValueChange={(enabled) => {
              playHaptic('selection');
              onKeepAwakeChange(enabled);
            }}
            trackColor={{ false: '#DDE5DC', true: '#F0C263' }}
            thumbColor={keepAwakeEnabled ? '#E3A325' : '#FFFFFF'}
          />
        </View>
      </View>

      <View style={styles.settingCard}>
        <View style={styles.settingRow}>
          <View style={styles.settingTextBlock}>
            <View style={styles.settingTitleRow}>
              <History color="#E3A325" size={18} strokeWidth={2.4} />
              <Text style={styles.settingTitle}>Startup behavior</Text>
            </View>
            <Text style={styles.settingCaption}>Resume the last page you visited instead of opening Home.</Text>
          </View>
          <Switch
            value={resumePreviousSession}
            onValueChange={(enabled) => {
              playHaptic('selection');
              onResumePreviousSessionChange(enabled);
            }}
            trackColor={{ false: '#DDE5DC', true: '#F0C263' }}
            thumbColor={resumePreviousSession ? '#E3A325' : '#FFFFFF'}
          />
        </View>
      </View>

      <View style={styles.settingCard}>
        <View style={styles.settingTitleRow}>
          <MonitorPlay color="#E3A325" size={18} strokeWidth={2.4} />
          <Text style={styles.settingTitle}>Video playback</Text>
        </View>
        <Text style={styles.settingCaption}>Saved preferences are applied to HTML5 and Vimeo players when available.</Text>

        <Text style={styles.segmentLabel}>Speed</Text>
        <View style={styles.segmentRow}>
          {SPEED_OPTIONS.map((speed) => {
            const selected = preferences.speed === speed;
            return (
              <HapticPressable
                key={speed}
                haptic="selection"
                style={[styles.segmentButton, selected && styles.segmentButtonSelected]}
                onPress={() => onSpeedChange(speed)}
              >
                <Text style={[styles.segmentButtonText, selected && styles.segmentButtonTextSelected]}>
                  {formatSpeed(speed)}
                </Text>
              </HapticPressable>
            );
          })}
        </View>

        <Text style={styles.segmentLabel}>Quality</Text>
        <View style={styles.segmentRow}>
          {QUALITY_OPTIONS.map((quality) => {
            const selected = preferences.quality === quality;
            return (
              <HapticPressable
                key={quality}
                haptic="selection"
                style={[styles.segmentButton, selected && styles.segmentButtonSelected]}
                onPress={() => onQualityChange(quality)}
              >
                <Text style={[styles.segmentButtonText, selected && styles.segmentButtonTextSelected]}>
                  {formatQuality(quality)}
                </Text>
              </HapticPressable>
            );
          })}
        </View>
      </View>

      <View style={styles.settingCard}>
        <View style={styles.settingRow}>
          <View style={styles.settingTextBlock}>
            <View style={styles.settingTitleRow}>
              <Bell color="#E3A325" size={18} strokeWidth={2.4} />
              <Text style={styles.settingTitle}>Daily learning reminder</Text>
            </View>
            <Text style={styles.settingCaption}>Get a gentle nudge to keep your study habit alive.</Text>
          </View>
          <Switch
            value={reminder.enabled}
            onValueChange={(enabled) => {
              playHaptic('selection');
              onReminderToggle(enabled);
            }}
            trackColor={{ false: '#DDE5DC', true: '#F0C263' }}
            thumbColor={reminder.enabled ? '#E3A325' : '#FFFFFF'}
          />
        </View>

        <View style={styles.settingDivider} />

        <HapticPressable style={styles.reminderTimeRow} haptic="selection" onPress={onOpenTimePicker}>
          <View style={styles.settingTextBlock}>
            <Text style={styles.settingTitle}>Reminder time</Text>
            <Text style={styles.settingCaption}>Choose when to receive your daily reminder.</Text>
          </View>
          <Text style={styles.reminderTimeText}>{formatReminderTime(reminder.hour, reminder.minute)}</Text>
        </HapticPressable>

        <View style={styles.settingDivider} />

        <HapticPressable style={styles.testNotificationButton} haptic="success" onPress={onSendTestNotification}>
          <Bell color="#E3A325" size={18} strokeWidth={2.4} />
          <Text style={styles.testNotificationText}>Send Test Notification</Text>
        </HapticPressable>
      </View>
    </Sheet>
  );
}

function TimePickerPanel({
  open,
  reminder,
  onClose,
  onSelectTime,
}: {
  open: boolean;
  reminder: ReminderSettings;
  onClose: () => void;
  onSelectTime: (hour: number, minute: number) => void;
}) {
  const selectedIndex = reminder.hour * 4 + Math.floor(reminder.minute / 15);
  const renderTimeOption = useCallback(
    ({ item }: { item: TimeOption }) => {
      const selected = reminder.hour === item.hour && reminder.minute === item.minute;
      return (
        <Pressable
          android_ripple={{ color: '#F8E5BE' }}
          style={({ pressed }) => [
            styles.timeOption,
            selected && styles.timeOptionSelected,
            pressed && styles.timeOptionPressed,
          ]}
          onPress={() => {
            playHaptic('selection');
            onSelectTime(item.hour, item.minute);
          }}
        >
          <View style={styles.timeOptionIcon}>
            <Clock3 color={selected ? '#FFFFFF' : '#E3A325'} size={18} strokeWidth={2.4} />
          </View>
          <Text style={[styles.timeOptionText, selected && styles.timeOptionTextSelected]}>
            {formatReminderTime(item.hour, item.minute)}
          </Text>
          {selected ? <Check color="#E3A325" size={20} strokeWidth={2.7} /> : null}
        </Pressable>
      );
    },
    [onSelectTime, reminder.hour, reminder.minute]
  );

  return (
    <Sheet visible={open} title="Reminder Time" onClose={onClose} scrollable={false}>
      <FlatList
        data={TIME_OPTIONS}
        keyExtractor={(item) => `${item.hour}:${item.minute}`}
        renderItem={renderTimeOption}
        style={styles.timeList}
        contentContainerStyle={styles.timeListContent}
        showsVerticalScrollIndicator={false}
        initialScrollIndex={selectedIndex}
        getItemLayout={(_data, index) => ({ length: 48, offset: 48 * index, index })}
        initialNumToRender={18}
        maxToRenderPerBatch={18}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
      />
    </Sheet>
  );
}

function MiscPanel({
  open,
  onClose,
  onOpenDeveloper,
  onOpenYikora,
  onOpenReadingKulture,
}: {
  open: boolean;
  onClose: () => void;
  onOpenDeveloper: () => void;
  onOpenYikora: () => void;
  onOpenReadingKulture: () => void;
}) {
  return (
    <Sheet visible={open} title="Misc" onClose={onClose}>
      <View style={styles.aboutBrandRow}>
        <View style={styles.aboutLogoFrame}>
          <Image source={MIV_LOGO} style={styles.aboutLogo} resizeMode="contain" />
        </View>
        <View style={styles.aboutTextBlock}>
          <Text style={styles.aboutAppName}>Miv Unofficial</Text>
          <Text style={styles.aboutCaption}>Miva LMS unofficial companion app</Text>
        </View>
      </View>

      <View style={styles.creditBlock}>
        <Text style={styles.creditLabel}>Developed by</Text>
        <HapticPressable style={styles.developerLink} onPress={onOpenDeveloper}>
          <Text style={styles.developerName}>Creative Conceptz Solutions</Text>
          <Text style={styles.developerUrl}>conceptz.com.ng</Text>
        </HapticPressable>
      </View>

      <View style={styles.miscCardList}>
        <ExternalCard
          Icon={Users}
          title="Meet Miva students on Yikora"
          caption="Join a lightweight student space for conversations, study talk, and community. Connect with students from ALL Miva University departments and beyond."
          actionLabel="Use Yikora"
          onPress={onOpenYikora}
        />
        <ExternalCard
          Icon={BookMarked}
          title="Read smarter with ReadingKulture"
          caption="Use a free & powerful focused e-reader app for your learning materials, notes, and ebooks."
          actionLabel="Get ReadingKulture"
          onPress={onOpenReadingKulture}
        />
      </View>
    </Sheet>
  );
}

function ExternalCard({
  Icon,
  title,
  caption,
  actionLabel,
  onPress,
}: {
  Icon: typeof Users;
  title: string;
  caption: string;
  actionLabel: string;
  onPress: () => void;
}) {
  return (
    <HapticPressable style={styles.externalCard} onPress={onPress}>
      <View style={styles.externalIcon}>
        <Icon color="#E3A325" size={21} strokeWidth={2.4} />
      </View>
      <View style={styles.externalTextBlock}>
        <Text style={styles.externalTitle}>{title}</Text>
        <Text style={styles.externalCaption}>{caption}</Text>
        <View style={styles.externalActionRow}>
          <Text style={styles.externalActionText}>{actionLabel}</Text>
          <ExternalLink color="#E3A325" size={15} strokeWidth={2.4} />
        </View>
      </View>
    </HapticPressable>
  );
}

function Sheet({
  visible,
  title,
  onClose,
  children,
  scrollable = true,
  immediateClose = false,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  scrollable?: boolean;
  immediateClose?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetTranslateY = useRef(new Animated.Value(40)).current;

  const closeSheet = useCallback(() => {
    if (immediateClose) { onClose(); return; }
    Animated.timing(sheetTranslateY, {
      toValue: 520,
      duration: 170,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [immediateClose, onClose, sheetTranslateY]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    sheetTranslateY.setValue(48);
    Animated.spring(sheetTranslateY, {
      toValue: 0,
      speed: 24,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  }, [sheetTranslateY, visible]);

  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          gestureState.dy > 4 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_event, gestureState) => {
          sheetTranslateY.setValue(Math.max(0, gestureState.dy));
        },
        onPanResponderRelease: (_event, gestureState) => {
          if (gestureState.dy > 34 || gestureState.vy > 0.38) {
            playHaptic('selection');
            closeSheet();
            return;
          }

          Animated.spring(sheetTranslateY, {
            toValue: 0,
            speed: 24,
            bounciness: 7,
            useNativeDriver: true,
          }).start();
        },
      }),
    [closeSheet, sheetTranslateY]
  );

  const maxSheetHeight = Math.max(360, Math.min(windowHeight * 0.88, windowHeight - insets.top - 10));

  const content = scrollable ? (
    <ScrollView
      style={styles.sheetScroll}
      contentContainerStyle={styles.sheetScrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    children
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={closeSheet}>
      <KeyboardAvoidingView style={styles.modalScrim} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <HapticPressable style={StyleSheet.absoluteFill} pressScale={1} haptic="selection" onPress={closeSheet} />
        <Animated.View
          style={[
            styles.sheet,
            { maxHeight: maxSheetHeight, paddingBottom: Math.max(insets.bottom + 20, 28) },
            { transform: [{ translateY: sheetTranslateY }] },
          ]}
        >
          <View style={styles.sheetHandleTouchTarget} {...swipeResponder.panHandlers}>
            <View style={styles.sheetHandle} />
          </View>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <HapticPressable style={styles.closeButton} haptic="selection" onPress={closeSheet}>
              <Text style={styles.closeButtonText}>Done</Text>
            </HapticPressable>
          </View>
          {content}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    backgroundColor: '#151B17',
  },
  header: {
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#151B17',
  },
  brandLockup: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  brandLogo: {
    width: 42,
    height: 42,
  },
  brandTextBlock: {
    marginLeft: 10,
    flexShrink: 1,
  },
  brandName: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: 0,
  },
  brandSubname: {
    color: '#BFD2C4',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  roundIconButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D9E0D8',
    backgroundColor: '#FFFFFF',
  },
  roundIconButtonDark: {
    borderColor: '#334239',
    backgroundColor: '#202A24',
  },
  roundIconButtonDisabled: {
    borderColor: '#8A9890',
    backgroundColor: '#DDE6E0',
  },
  progressTrack: {
    height: 3,
    backgroundColor: '#D9E0D8',
  },
  progressFill: {
    height: 3,
    backgroundColor: '#E3A325',
  },
  webSurface: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  webView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  refreshBubble: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#EBD196',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  refreshBubbleText: {
    color: '#151B17',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
  },
  loadingState: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  errorState: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  errorTitle: {
    marginTop: 12,
    color: '#151B17',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  errorUrl: {
    marginTop: 8,
    color: '#68756D',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0,
  },
  errorActions: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primaryButton: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#E3A325',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  secondaryButton: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D9E0D8',
    backgroundColor: '#FFFFFF',
  },
  secondaryButtonText: {
    color: '#151B17',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  drawerScrim: {
    flex: 1,
    alignItems: 'flex-end',
    backgroundColor: 'rgba(21, 27, 23, 0.42)',
  },
  drawer: {
    width: '86%',
    maxWidth: 340,
    height: '100%',
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 20,
    backgroundColor: '#151B17',
  },
  drawerHeader: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  drawerBrandRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  drawerLogoFrame: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  drawerLogo: {
    width: 44,
    height: 44,
  },
  drawerTitleBlock: {
    marginLeft: 10,
    flex: 1,
    minWidth: 0,
  },
  drawerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  drawerSubtitle: {
    marginTop: 2,
    color: '#BFD2C4',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  drawerCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334239',
    backgroundColor: '#202A24',
  },
  drawerMenu: {
    marginTop: 18,
    gap: 8,
  },
  drawerBottom: {
    marginTop: 'auto',
    gap: 8,
  },
  drawerItem: {
    height: 52,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 10,
    backgroundColor: '#202A24',
  },
  drawerItemSelected: {
    backgroundColor: '#E3A325',
  },
  drawerItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F9F5',
  },
  drawerItemIconSelected: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  drawerItemText: {
    color: '#DDE8DF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0,
  },
  drawerItemTextSelected: {
    color: '#FFFFFF',
  },
  modalScrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(21, 27, 23, 0.42)',
  },
  sheet: {
    maxHeight: '88%',
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: 28,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  sheetScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  sheetScrollContent: {
    paddingBottom: 18,
  },
  sheetHandleTouchTarget: {
    alignSelf: 'center',
    width: 128,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CFD8D1',
  },
  sheetHeader: {
    marginTop: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: '#151B17',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  closeButton: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151B17',
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  settingCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E3E8E2',
    backgroundColor: '#FFFFFF',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  settingTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  settingTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingTitle: {
    color: '#1C2520',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
  },
  settingCaption: {
    marginTop: 5,
    color: '#7B887F',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    letterSpacing: 0,
  },
  settingDivider: {
    height: 1,
    marginVertical: 14,
    backgroundColor: '#E8ECE7',
  },
  reminderTimeRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  reminderTimeText: {
    color: '#E3A325',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  testNotificationButton: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  testNotificationText: {
    color: '#E3A325',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
  },
  segmentLabel: {
    marginTop: 14,
    marginBottom: 8,
    color: '#4F5C54',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  segmentButton: {
    minWidth: 58,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DDE5DC',
    backgroundColor: '#F7F9F5',
  },
  segmentButtonSelected: {
    borderColor: '#E3A325',
    backgroundColor: '#E3A325',
  },
  segmentButtonText: {
    color: '#151B17',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  segmentButtonTextSelected: {
    color: '#FFFFFF',
  },
  timeList: {
    maxHeight: 420,
  },
  timeListContent: {
    paddingBottom: 8,
  },
  timeOption: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  timeOptionSelected: {
    backgroundColor: '#FFF4DE',
  },
  timeOptionPressed: {
    backgroundColor: '#FFF1D6',
  },
  timeOptionIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F9F5',
  },
  timeOptionText: {
    flex: 1,
    color: '#151B17',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  timeOptionTextSelected: {
    color: '#E3A325',
  },
  aboutBrandRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  aboutLogoFrame: {
    width: 56,
    height: 56,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#151B17',
  },
  aboutLogo: {
    width: 56,
    height: 56,
  },
  aboutTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  aboutAppName: {
    color: '#151B17',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  aboutCaption: {
    marginTop: 2,
    color: '#68756D',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
  creditBlock: {
    marginTop: 22,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#DDE5DC',
  },
  creditLabel: {
    color: '#68756D',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  developerLink: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDE5DC',
    backgroundColor: '#F7F9F5',
  },
  developerName: {
    color: '#151B17',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
  },
  developerUrl: {
    marginTop: 2,
    color: '#E3A325',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  miscCardList: {
    marginTop: 18,
    gap: 10,
  },
  externalCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 13,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E3E8E2',
    backgroundColor: '#FFFFFF',
  },
  externalIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF4DE',
  },
  externalTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  externalTitle: {
    color: '#151B17',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0,
  },
  externalCaption: {
    marginTop: 4,
    color: '#68756D',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    letterSpacing: 0,
  },
  externalActionRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  externalActionText: {
    color: '#E3A325',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
  },
});








