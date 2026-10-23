// String.raw keeps regular expressions intact when this script reaches WebView.
export const buildPageBridgeScript = () => String.raw`
(function () {
  if (window.MivBridge || window.top !== window) return;
  var playing = new Set();
  var videoTarget = null;
  var inPip = false;
  var vimeoFrames = new WeakMap();
  var pipStyle = null;
  var resumeOnPip = false;
  var reportedPlaying = false;
  function post(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  function pdfUrl(value) {
    try {
      var url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol)) return false;
      if (/\.pdf$/i.test(decodeURIComponent(url.pathname))) return true;
      return ['file', 'filename', 'download', 'url'].some(function (key) {
        var parameter = url.searchParams.get(key);
        return parameter !== null && /\.pdf(?:$|[?#])/i.test(parameter);
      });
    } catch (_) { return false; }
  }
  function externalPdf(value) {
    try {
      var url = new URL(value, location.href);
      if (/^https?:$/.test(url.protocol)) post({ type: 'open-pdf', url: url.href });
    } catch (_) {}
  }
  function reportPlayback(target, active) {
    if (active) { playing.add(target); videoTarget = target; }
    else playing.delete(target);
    playing.forEach(function (element) { if (!element.isConnected) playing.delete(element); });
    if (!playing.has(videoTarget)) videoTarget = Array.from(playing).pop() || (resumeOnPip && videoTarget && videoTarget.isConnected ? videoTarget : null);
    var activeNow = playing.size > 0;
    if (activeNow !== reportedPlaying) {
      reportedPlaying = activeNow;
      post({ type: 'video-state', playing: activeNow });
    }
  }
  function vimeoCommand(frame, method, value) {
    if (frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ method: method, value: value }), 'https://player.vimeo.com');
  }
  function scan() {
    document.querySelectorAll('iframe[src], embed[src], object[data]').forEach(function (node) {
      try {
      var source = node.getAttribute('src') || node.getAttribute('data');
      var mime = (node.getAttribute('type') || '').toLowerCase();
      if (source && (pdfUrl(source) || mime === 'application/pdf')) {
        var url = new URL(source, location.href).href;
        if (!/^https?:/.test(url)) return;
        node.removeAttribute('src'); node.removeAttribute('data');
        var button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Open PDF in browser';
        button.style.cssText = 'display:block;padding:14px 18px;margin:12px 0;border:0;border-radius:8px;background:#E3A325;color:#151B17;font:600 15px system-ui;';
        button.addEventListener('click', function () { externalPdf(url); });
        node.replaceWith(button);
        return;
      }
      if (node.tagName !== 'IFRAME' || !source) return;
      var parsed;
      try { parsed = new URL(source, location.href); } catch (_) { return; }
      if (parsed.hostname !== 'player.vimeo.com') return;
      var previous = vimeoFrames.get(node);
      if (previous && previous.source === parsed.href) return;
      vimeoFrames.set(node, { source: parsed.href, observed: false });
      function subscribe() {
        ['play', 'pause', 'ended', 'loaded'].forEach(function (name) { vimeoCommand(node, 'addEventListener', name); });
        vimeoCommand(node, 'getPaused');
      }
      if (!previous) node.addEventListener('load', subscribe);
      subscribe();
      } catch (_) {}
    });
    document.querySelectorAll('video').forEach(function (video) {
      reportPlayback(video, !video.paused && !video.ended);
    });
    playing.forEach(function (node) { if (!node.isConnected) reportPlayback(node, false); });
  }
  window.addEventListener('message', function (event) {
    if (event.origin !== 'https://player.vimeo.com') return;
    var frame = Array.from(document.querySelectorAll('iframe')).find(function (node) { return node.contentWindow === event.source; });
    if (!frame) return;
    var data;
    try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch (_) { return; }
    if (!data) return;
    var state = vimeoFrames.get(frame);
    if (!state) return;
    if (data.event === 'ready' || data.event === 'loaded') {
      ['play', 'pause', 'ended'].forEach(function (name) { vimeoCommand(frame, 'addEventListener', name); });
      vimeoCommand(frame, 'getPaused');
    }
    if (data.event === 'play' || data.event === 'pause' || data.event === 'ended') {
      state.observed = true;
      reportPlayback(frame, data.event === 'play');
    }
    if (!state.observed && data.method === 'getPaused' && typeof data.value === 'boolean') reportPlayback(frame, !data.value);
  });
  ['playing', 'pause', 'ended', 'emptied'].forEach(function (name) {
    document.addEventListener(name, function (event) {
      if (event.target.tagName === 'VIDEO') reportPlayback(event.target, name === 'playing');
    }, true);
  });
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href]');
    if (!link || event.defaultPrevented) return;
    var url;
    try { url = new URL(link.href, location.href); } catch (_) { return; }
    if (pdfUrl(url.href) || link.type === 'application/pdf') {
      event.preventDefault(); event.stopImmediatePropagation(); externalPdf(url.href); return;
    }
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
    if (/^https?:$/.test(url.protocol) && (!link.target || link.target === '_self') && !link.hasAttribute('download')) {
      Promise.resolve().then(function () {
        if (!event.defaultPrevented) post({ type: 'navigation-start', url: url.href });
      });
    }
  }, true);
  document.addEventListener('submit', function (event) {
    Promise.resolve().then(function () {
      if (!event.defaultPrevented) post({ type: 'navigation-start', url: event.target.action || location.href });
    });
  }, true);
  function setPip(enabled) {
    inPip = enabled;
    if (pipStyle) pipStyle.remove(); pipStyle = null;
    document.querySelectorAll('[data-miv-pip]').forEach(function (node) { node.removeAttribute('data-miv-pip'); });
    document.querySelectorAll('[data-miv-pip-parent]').forEach(function (node) { node.removeAttribute('data-miv-pip-parent'); });
    if (!enabled) { resumeOnPip = false; return; }
    if (!videoTarget || !videoTarget.isConnected) return;
    videoTarget.setAttribute('data-miv-pip', 'true');
    for (var ancestor = videoTarget.parentElement; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
      ancestor.setAttribute('data-miv-pip-parent', 'true');
    }
    pipStyle = document.createElement('style');
    pipStyle.textContent = 'html,body{overflow:hidden!important;background:#000!important}body *{visibility:hidden!important}[data-miv-pip-parent]{transform:none!important;filter:none!important;perspective:none!important;contain:none!important;overflow:visible!important;clip-path:none!important;will-change:auto!important;content-visibility:visible!important}[data-miv-pip]{visibility:visible!important;display:block!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483647!important;object-fit:contain!important;background:#000!important}';
    document.documentElement.appendChild(pipStyle);
    if (resumeOnPip || playing.has(videoTarget)) {
      if (videoTarget.tagName === 'IFRAME') vimeoCommand(videoTarget, 'play');
      else videoTarget.play().catch(function () {});
    }
  }
  window.MivBridge = {
    setPip: setPip,
    preparePip: function (wasPlaying) { resumeOnPip = wasPlaying === true || playing.size > 0; },
    pauseMedia: function () {
      resumeOnPip = false;
      playing.forEach(function (node) {
        if (node.tagName === 'IFRAME') vimeoCommand(node, 'pause');
        else node.pause();
      });
    }
  };
  scan();
  var scheduled = false;
  var observing = false;
  function observe() {
    if (observing || !document.documentElement) return;
    observing = true;
    new MutationObserver(function () {
      if (scheduled || inPip) return;
      scheduled = true;
      setTimeout(function () { scheduled = false; scan(); }, 80);
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data'] });
  }
  observe();
  document.addEventListener('DOMContentLoaded', function () { scan(); observe(); }, { once: true });
})();
true;
`;
