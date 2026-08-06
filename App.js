import { useRef, useState, useEffect } from 'react';
import { StyleSheet, View, Text, Image, TouchableOpacity, TouchableWithoutFeedback, Animated, Dimensions, PanResponder } from 'react-native';
import { WebView } from 'react-native-webview';

const { width: SW, height: SH } = Dimensions.get('window');
const VIDEO_H = Math.round(SW * 9 / 16);
const VIDEO_TOP = Math.round((SH - VIDEO_H) / 2);
const VIDEO_BOTTOM = VIDEO_TOP + VIDEO_H;
const THEATER_BTNS_TOP = VIDEO_TOP - 68;

const BRAND = '#FFC000';
const NAVY  = '#141B41';

// ─── Pre-content injection — runs before YouTube JS loads ────────────────────
// Spoofs the Page Visibility API so YouTube never sees the page as hidden,
// which prevents it from pausing video when the screen locks or app backgrounds.
const VISIBILITY_SPOOF_JS = `
(function() {
  try {
    Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
    Object.defineProperty(document, 'hidden',          { get: function() { return false;     }, configurable: true });
    // Swallow visibilitychange and pagehide events before they reach YouTube's handlers
    var _addEL = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, fn, opts) {
      if (type === 'visibilitychange' || type === 'pagehide') return;
      return _addEL.call(this, type, fn, opts);
    };
  } catch(e) {}
  true;
})();
`;

// ─── Single browse + preview injection ───────────────────────────────────────
// Everything happens in one WebView. On tap: center the thumbnail so YouTube
// auto-starts the preview, then zoom it fullscreen.
const BROWSE_JS = `
(function() {
  if (window.__browseInjected) return;
  window.__browseInjected = true;

  var SW = ${SW}; var SH = ${SH};
  function post(m){ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }

  // ── Mode helpers ──────────────────────────────────────────────────────────
  function applyLandscape(o, v) {
    o.style.cssText = ['position:fixed','width:'+SH+'px','height:'+SW+'px',
      'left:'+((SW-SH)/2)+'px','top:'+((SH-SW)/2)+'px',
      'transform:rotate(90deg)','transform-origin:center center',
      'background:#000','z-index:99991','overflow:hidden',
      'display:flex','align-items:center','justify-content:center'].join(';');
    v.setAttribute('style',['display:block !important','position:relative !important',
      'width:'+SH+'px !important','height:'+SW+'px !important',
      'object-fit:contain !important','margin:0 !important','padding:0 !important'].join(';'));
  }
  function applyTheater(o, v) {
    o.style.cssText = ['position:fixed','top:0','left:0','width:100vw','height:100vh',
      'background:#000','z-index:99991','display:flex',
      'flex-direction:column','align-items:center','justify-content:center'].join(';');
    v.setAttribute('style',['display:block !important','position:relative !important',
      'width:'+SW+'px !important','height:'+Math.round(SW*9/16)+'px !important',
      'object-fit:contain !important','margin:0 !important','padding:0 !important'].join(';'));
  }
  window.__setVideoMode = function(m) {
    if (!window.__previewOverlay || !window.__previewVid) return;
    if (m === 'theater') applyTheater(window.__previewOverlay, window.__previewVid);
    else applyLandscape(window.__previewOverlay, window.__previewVid);
  };

  // ── Cleanup (called when user exits preview) ──────────────────────────────
  window.__exitPreview = function() {
    if (window.__timeInterval)  { clearInterval(window.__timeInterval);  window.__timeInterval  = null; }
    if (window.__unmuteInterval){ clearInterval(window.__unmuteInterval); window.__unmuteInterval = null; }
    if (window.__previewVid) {
      window.__previewVid.pause();
      window.__previewVid.muted = true;
      window.__previewVid = null;
    }
    // Remove overlays — do NOT restore video element back into YouTube DOM,
    // that triggers YouTube JS and auto-plays other videos
    if (window.__previewOverlay)  { window.__previewOverlay.remove();  window.__previewOverlay = null; }
    if (window.__previewBackdrop) { window.__previewBackdrop.remove(); window.__previewBackdrop = null; }
    if (window.__previewDimmer)   { window.__previewDimmer.remove();   window.__previewDimmer = null; }
  };

  // ── Zoom the video fullscreen ─────────────────────────────────────────────
  function zoomVideo(vid) {
    window.__previewVidParent = vid.parentElement;
    window.__previewVidNext   = vid.nextSibling;
    window.__previewVid = vid;
    window.__activeVid = vid; // unified handle used by React Native controls

    var backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:99990;';
    window.__previewBackdrop = backdrop;
    document.body.appendChild(backdrop);

    var overlay = document.createElement('div');
    window.__previewOverlay = overlay;
    document.body.appendChild(overlay);
    overlay.appendChild(vid);
    vid.setAttribute('playsinline','true');

    // Default to theater (vertical) mode
    applyTheater(overlay, vid);

    // Unmute: keep retrying every 250ms for as long as the preview is open,
    // because YouTube mobile re-mutes the video element continuously.
    function tryUnmute() {
      vid.muted = false;
      vid.volume = 1;
    }
    tryUnmute();
    vid.play().catch(function(){});
    if (window.__unmuteInterval) clearInterval(window.__unmuteInterval);
    window.__unmuteInterval = setInterval(function() {
      if (!window.__previewVid) { clearInterval(window.__unmuteInterval); window.__unmuteInterval = null; return; }
      tryUnmute();
      if (vid.paused) vid.play().catch(function(){});
    }, 250);

    window.__timeInterval = setInterval(function() {
      if (!window.__previewVid) return;
      post({ type:'TIME_UPDATE', currentTime: window.__previewVid.currentTime||0, duration: window.__previewVid.duration||0 });
    }, 500);

    post({ type:'PREVIEW_READY' });
  }

  // ── Tap intercept ─────────────────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    // Walk up from the tapped element to find the video link.
    // We check the tapped element AND every ancestor up to the item container,
    // but never jump sideways to a different item (which would pick the wrong video).
    var link = e.target.closest('a[href*="watch?v="]');
    if (!link) {
      // Target might be text/image inside a non-anchor — find the item container
      // and pick the link that is a direct ancestor of the tapped element
      var item = e.target.closest('ytm-media-item,ytm-compact-video-renderer,ytm-rich-item-renderer,.compact-media-item');
      if (item) {
        // Prefer thumbnail link (most specific to the tapped area)
        var thumb = e.target.closest('[class*="thumbnail"] a,[class*="image"] a,.compact-media-item-image a');
        if (thumb && thumb.href && thumb.href.includes('watch?v=')) { link = thumb; }
        else {
          // Try every <a> inside the item and pick the one that is an ancestor of the tapped element
          var anchors = item.querySelectorAll('a[href*="watch?v="]');
          for (var i = 0; i < anchors.length; i++) {
            if (anchors[i].contains(e.target)) { link = anchors[i]; break; }
          }
          // Last resort: first anchor in this item only
          if (!link && anchors.length > 0) link = anchors[0];
        }
      }
    }
    if (!link) return;
    var match = (link.href||link.getAttribute('href')||'').match(/[?&]v=([^&]+)/);
    if (!match) return;

    e.preventDefault(); e.stopPropagation();

    // Unlock iOS audio within the user gesture (must be synchronous)
    try { var au = new Audio(); au.play().catch(function(){}); } catch(ignore) {}

    var container = link.closest('ytm-media-item,ytm-compact-video-renderer,ytm-rich-item-renderer,.compact-media-item');
    if (!container) container = link.parentElement;

    post({ type:'VIDEO_TAPPED', videoId: match[1] });

    // Fade to black smoothly BEFORE scrolling so movement is hidden
    var dimmer = document.createElement('div');
    dimmer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:99989;opacity:0;transition:opacity 0.25s ease;pointer-events:none;';
    window.__previewDimmer = dimmer;
    document.body.appendChild(dimmer);
    requestAnimationFrame(function() {
      requestAnimationFrame(function() { dimmer.style.opacity = '1'; });
    });

    // Center the thumbnail after dim starts (movement hidden under black)
    setTimeout(function() {
      container.scrollIntoView({ behavior:'smooth', block:'center' });
      ['mouseenter','mouseover','pointerenter','pointermove'].forEach(function(ev) {
        container.dispatchEvent(new MouseEvent(ev, { bubbles:true, cancelable:true }));
      });
    }, 200);

    // Poll for video element, then zoom once scroll has settled
    var tries = 0;
    var poll = setInterval(function() {
      var vid = container.querySelector('video') || document.querySelector('video');
      if (vid) {
        clearInterval(poll);
        setTimeout(function() { zoomVideo(vid); }, 400);
        return;
      }
      if (++tries > 50) { clearInterval(poll); post({ type:'DEBUG', msg:'No video found' }); }
    }, 300);
  }, true);

  true;
})();
`;

// ─── Hidden "Premium" ad-watcher injection ───────────────────────────────────
// Loaded in a second, normally-invisible WebView pointed at the real video's
// embed page. Polls for YouTube's ad UI; reports state back so React Native
// can swap which video is in the foreground.
const AD_JS = `
(function() {
  if (window.__adInjected) return;
  window.__adInjected = true;

  var SW = ${SW}; var SH = ${SH};
  function post(m){ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }

  // Hide the ENTIRE page by default. visibility:hidden (not display:none) lets
  // specific descendants override back to visible while everything else —
  // comments, related videos, the works — stays invisible, letting the
  // transparent native WebView background show the preview through underneath.
  // Also explicitly null out html/body's own background-color: browsers paint
  // that onto the page's root "canvas" as a special case that visibility:hidden
  // does NOT suppress, so without this the canvas color alone can still cover
  // whatever's behind the WebView even though everything else is hidden.
  document.documentElement.style.visibility = 'hidden';
  document.documentElement.style.backgroundColor = 'transparent';
  document.addEventListener('DOMContentLoaded', function() {
    if (document.body) document.body.style.backgroundColor = 'transparent';
  });
  if (document.body) document.body.style.backgroundColor = 'transparent';

  function ensureOverlay() {
    if (window.__adOverlay) return window.__adOverlay;
    var backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:99988;visibility:hidden;';
    document.body.appendChild(backdrop);
    window.__adBackdrop = backdrop;

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99989;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;visibility:hidden;';
    document.body.appendChild(overlay);
    window.__adOverlay = overlay;
    return overlay;
  }
  function revealVideo() {
    if (window.__adBackdrop) window.__adBackdrop.style.visibility = 'visible';
    if (window.__adOverlay)  window.__adOverlay.style.visibility  = 'visible';
  }
  function concealVideo() {
    if (window.__adBackdrop) window.__adBackdrop.style.visibility = 'hidden';
    if (window.__adOverlay)  window.__adOverlay.style.visibility  = 'hidden';
  }

  function applyLandscape(v) {
    v.setAttribute('style', ['display:block !important','position:relative !important',
      'top:auto !important','left:auto !important','right:auto !important','bottom:auto !important',
      'width:'+SH+'px !important','height:'+SW+'px !important',
      'transform:rotate(90deg) !important','transform-origin:center center !important',
      'object-fit:contain !important','margin:0 !important','padding:0 !important'].join(';'));
  }
  function applyTheater(v) {
    v.setAttribute('style', ['display:block !important','position:relative !important',
      'top:auto !important','left:auto !important','right:auto !important','bottom:auto !important',
      'width:'+SW+'px !important','height:'+Math.round(SW*9/16)+'px !important',
      'object-fit:contain !important','margin:0 !important','padding:0 !important'].join(';'));
  }
  window.__adSetMode = function(m) {
    if (!window.__adVid) return;
    if (m === 'theater') applyTheater(window.__adVid);
    else applyLandscape(window.__adVid);
  };
  window.__adSetMuted = function(m) {
    if (!window.__adVid) return;
    window.__adVid.muted = m;
    if (!m) { window.__adVid.volume = 1; window.__adVid.play().catch(function(){}); }
  };

  // Settings-menu driven controls — now that we're on desktop YouTube, the real
  // gear icon/menu exists, so we drive it the same way a finger would rather than
  // relying on deprecated/ignored direct API calls.
  function clickMenuItemContaining(text) {
    var items = document.querySelectorAll('.ytp-menuitem');
    for (var i = 0; i < items.length; i++) {
      if ((items[i].textContent || '').toLowerCase().indexOf(text) !== -1) {
        items[i].click();
        return items[i];
      }
    }
    return null;
  }
  function openSettingsSubmenu(submenuName, cb) {
    var gear = document.querySelector('.ytp-settings-button');
    if (!gear) { cb(null, 'no-gear'); return; }
    gear.click();
    setTimeout(function() {
      var item = clickMenuItemContaining(submenuName);
      if (!item) { cb(null, 'no-' + submenuName + '-menuitem'); gear.click(); return; }
      setTimeout(function() { cb(document.querySelectorAll('.ytp-menuitem'), null); }, 350);
    }, 350);
  }

  window.__adAutoHighestQuality = function() {
    openSettingsSubmenu('quality', function(items, err) {
      if (err) { post({ type:'QUALITY_OPTIONS', options:[], selected:null, debug:err }); return; }
      var opts = [], best = null, bestNum = -1;
      items.forEach(function(it) {
        var txt = (it.textContent || '').trim();
        opts.push(txt);
        var m = txt.match(/(\\d{3,4})p/);
        if (m) { var n = parseInt(m[1], 10); if (n > bestNum) { bestNum = n; best = it; } }
      });
      if (best) { best.click(); post({ type:'QUALITY_OPTIONS', options: opts, selected: bestNum + 'p' }); }
      else { post({ type:'QUALITY_OPTIONS', options: opts, selected: null }); var g = document.querySelector('.ytp-settings-button'); if (g) g.click(); }
    });
  };
  window.__adSetQualityByLabel = function(label) {
    openSettingsSubmenu('quality', function(items, err) {
      if (err) { post({ type:'QUALITY_SET', level: label, found:false }); return; }
      var item = null;
      for (var i = 0; i < items.length; i++) { if ((items[i].textContent||'').toLowerCase().indexOf(label.toLowerCase()) !== -1) { item = items[i]; break; } }
      if (item) { item.click(); post({ type:'QUALITY_SET', level: label, found:true }); }
      else { post({ type:'QUALITY_SET', level: label, found:false }); var g = document.querySelector('.ytp-settings-button'); if (g) g.click(); }
    });
  };

  window.__adToggleCaptions = function() {
    var ccBtn = document.querySelector('.ytp-subtitles-button');
    if (!ccBtn) { post({ type:'CC_TOGGLED', available:false }); return; }
    ccBtn.click();
    var enabled = ccBtn.getAttribute('aria-pressed') === 'true' || ccBtn.classList.contains('ytp-button-active');
    post({ type:'CC_TOGGLED', available:true, enabled: enabled });
  };

  window.__adSetSpeed = function(label) {
    openSettingsSubmenu('speed', function(items, err) {
      if (err) { post({ type:'SPEED_SET', level:label, found:false }); return; }
      var item = null;
      for (var i = 0; i < items.length; i++) { if ((items[i].textContent||'').toLowerCase().indexOf(label.toLowerCase()) !== -1) { item = items[i]; break; } }
      if (item) { item.click(); post({ type:'SPEED_SET', level:label, found:true }); }
      else { post({ type:'SPEED_SET', level:label, found:false }); var g = document.querySelector('.ytp-settings-button'); if (g) g.click(); }
    });
  };


  function findMainVideo() {
    var player = document.querySelector('#movie_player video, .html5-video-container video, ytm-watch video, #player video');
    return player || document.querySelector('video');
  }

  function tryStartPlayback(vid) {
    if (!vid || !vid.paused) return;
    vid.play().catch(function(){});
    var playBtn = document.querySelector('.ytp-large-play-button, button[aria-label="Play"], .ytp-play-button');
    if (playBtn) { try { playBtn.click(); } catch(e) {} }
  }

  // ── Upgrade button — a REAL DOM click here is what lets us unmute audio.
  // Tapping a React Native button overlaying the WebView would NOT count as a
  // gesture on this page, so this has to be an element rendered inside it.
  window.__adPhase = 'hidden'; // 'hidden' | 'awaitingTap' | 'real'

  function showUpgradeButton() {
    if (document.getElementById('__glumpseUpgradeBtn')) return;
    var btn = document.createElement('div');
    btn.id = '__glumpseUpgradeBtn';
    btn.innerText = 'HD';
    btn.style.cssText = [
      'position:fixed !important','visibility:visible !important',
      'top:60px','left:16px',
      'z-index:999999','padding:8px 16px','border-radius:18px',
      'background:#FFC000','color:#141B41','font-weight:700','font-size:13px',
      'letter-spacing:1px','display:flex','align-items:center','justify-content:center',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4)','border:2px solid #141B41'
    ].join(';');
    btn.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      var vid = window.__adVid;
      if (vid) { vid.muted = false; vid.volume = 1; vid.play().catch(function(){}); }
      revealVideo();
      btn.remove();
      window.__adPhase = 'real';
      post({ type:'UNMUTE_TAPPED' });
    }, true);
    document.body.appendChild(btn);
  }
  function hideUpgradeButton() {
    var btn = document.getElementById('__glumpseUpgradeBtn');
    if (btn) btn.remove();
  }

  function checkAdState() {
    var adShowing = !!document.querySelector(
      '.ad-showing, .ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-skip-button-container, ' +
      '.video-ads .ytp-ad-module, [class*="ad-showing"], ytm-companion-ad-renderer, ' +
      'ytm-promoted-sparkles-web-renderer'
    );
    var vid = findMainVideo();

    if (vid && window.__adVid !== vid) {
      window.__adVid = vid;
      window.__activeVid = vid; // unified handle React Native controls use
      vid.setAttribute('playsinline','true');
      vid.muted = true;
      var overlay = ensureOverlay();
      overlay.appendChild(vid);
      applyTheater(vid);
      tryStartPlayback(vid);
      window.__adTimeInterval && clearInterval(window.__adTimeInterval);
      window.__adTimeInterval = setInterval(function() {
        if (!window.__adVid) return;
        tryStartPlayback(window.__adVid);
        post({ type:'AD_TIME_UPDATE', currentTime: window.__adVid.currentTime||0, duration: window.__adVid.duration||0 });
      }, 500);
    } else if (vid) {
      tryStartPlayback(vid);
    }

    var hasVideo = !!(vid && vid.readyState >= 2);

    if (window.__adPhase === 'hidden' && !adShowing && hasVideo) {
      // Ad ended (or there never was one) — offer the upgrade, don't force it
      showUpgradeButton();
      window.__adPhase = 'awaitingTap';
      post({ type:'AD_READY_FOR_TAP' });
    } else if (window.__adPhase === 'awaitingTap' && adShowing) {
      // A new ad started before they tapped — go back to fully hidden
      hideUpgradeButton();
      concealVideo();
      window.__adPhase = 'hidden';
      post({ type:'AD_RESUMED' });
    } else if (window.__adPhase === 'real' && adShowing) {
      // Mid-roll after they'd already upgraded — drop back, will re-offer once it ends
      if (window.__adVid) window.__adVid.muted = true;
      concealVideo();
      window.__adPhase = 'hidden';
      post({ type:'AD_RESUMED' });
    }

    post({ type:'AD_STATE', phase: window.__adPhase });
  }

  setInterval(checkAdState, 400);
  true;
})();
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return m + ':' + (sec<10?'0':'') + sec;
}
const cmd = js => js + '; true;';


// ─── VideoSlider ──────────────────────────────────────────────────────────────
function VideoSlider({ value, maximumValue, onValueChange, onSlidingStart, onSlidingComplete }) {
  const trackWidth = useRef(0);
  const ratio = maximumValue > 0 ? Math.min(value / maximumValue, 1) : 0;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => {
      onSlidingStart?.();
      const x = Math.max(0, Math.min(e.nativeEvent.locationX, trackWidth.current||1));
      onValueChange?.((x/(trackWidth.current||1))*maximumValue);
    },
    onPanResponderMove: e => {
      const x = Math.max(0, Math.min(e.nativeEvent.locationX, trackWidth.current||1));
      onValueChange?.((x/(trackWidth.current||1))*maximumValue);
    },
    onPanResponderRelease: e => {
      const x = Math.max(0, Math.min(e.nativeEvent.locationX, trackWidth.current||1));
      onSlidingComplete?.((x/(trackWidth.current||1))*maximumValue);
    },
  })).current;

  return (
    <View style={sl.track} onLayout={e=>{trackWidth.current=e.nativeEvent.layout.width;}} {...pan.panHandlers}>
      <View style={[sl.fill,{width:(ratio*100)+'%'}]}/>
      <View style={[sl.thumb,{left:(ratio*100)+'%'}]}/>
    </View>
  );
}
const sl = StyleSheet.create({
  track: { flex:1, height:36, justifyContent:'center' },
  fill:  { height:3, backgroundColor:BRAND, borderRadius:2 },
  thumb: { position:'absolute', width:14, height:14, borderRadius:7, backgroundColor:'#fff', top:'50%', marginTop:-7, marginLeft:-7, shadowColor:'#000', shadowOpacity:0.4, shadowRadius:3, elevation:3 },
});

// ─── Gold swoosh — plays once when the HD upgrade becomes available ──────────
// Simple full-screen opacity pulse — fewer moving parts than a translating bar,
// so it can't silently fail to animate.
function Swoosh({ play }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!play) return;
    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 0.28, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0,    duration: 550, useNativeDriver: true }),
    ]).start();
  }, [play]);

  return <Animated.View pointerEvents="none" style={[swooshStyles.glow, { opacity }]} />;
}
const swooshStyles = StyleSheet.create({
  glow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BRAND,
    zIndex: 60,
  },
});

// ─── Shared button styles ─────────────────────────────────────────────────────
const btn = { alignItems:'center', justifyContent:'center', width:56, height:56, borderRadius:28, backgroundColor:'rgba(255,255,255,0.12)' };
const btnText = { color:'#fff', fontSize:20, lineHeight:22 };
const btnSub  = { color:'#fff', fontSize:10, fontWeight:'600' };
const muteStyle = { color:'#fff', fontSize:15, fontWeight:'700', letterSpacing:1 };
const playBtnStyle = { width:68, height:68, borderRadius:34, backgroundColor:'rgba(255,255,255,0.18)', alignItems:'center', justifyContent:'center' };
const playIconStyle = { color:'#fff', fontSize:24, letterSpacing:2 };
const timeStyle = { color:'#fff', fontSize:12, fontWeight:'500', minWidth:36, textAlign:'center' };
const rowStyle  = { flexDirection:'row', alignItems:'center', gap:8 };
const centerRowStyle = { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:28 };
const iconBtnStyle = { width:52, height:52, borderRadius:26, backgroundColor:'rgba(255,255,255,0.15)', alignItems:'center', justifyContent:'center' };
const iconBtnTextStyle = { color:'#fff', fontSize:22, fontWeight:'600' };
const pillRowStyle = { flexDirection:'row', justifyContent:'center', gap:8 };
const pillBtnStyle = { paddingHorizontal:12, height:34, borderRadius:17, backgroundColor:'rgba(255,255,255,0.14)', alignItems:'center', justifyContent:'center' };
const pillTextStyle = { color:'#fff', fontSize:11, fontWeight:'700', letterSpacing:0.5 };
const pillTextActiveStyle = { color:BRAND, fontSize:11, fontWeight:'700', letterSpacing:0.5 };

// ─── Landscape controls ───────────────────────────────────────────────────────
function LandscapeControls({ playing, muted, currentTime, duration, isReal, quality, ccEnabled, speed,
  onClose, onTogglePlay, onSkip, onToggleMute, onCycleQuality, onToggleCC, onCycleSpeed,
  onSliderChange, onSlidingStart, onSlidingComplete, onToggleMode, onDismiss }) {
  return (
    <>
      <TouchableOpacity style={lc.closeBtn} onPress={onClose}>
        <Text style={iconBtnTextStyle}>✕</Text>
      </TouchableOpacity>
      <TouchableOpacity style={lc.modeBtn} onPress={onToggleMode}>
        <Text style={lc.modeBtnText}>⤢</Text>
      </TouchableOpacity>
      <TouchableWithoutFeedback onPress={onDismiss}>
      <View style={lc.overlay}>
        <View style={lc.controlsGroup}>
          {isReal && (
            <View style={pillRowStyle}>
              <TouchableOpacity style={pillBtnStyle} onPress={onCycleQuality}>
                <Text style={pillTextStyle}>{quality}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={pillBtnStyle} onPress={onToggleCC}>
                <Text style={ccEnabled ? pillTextActiveStyle : pillTextStyle}>CC</Text>
              </TouchableOpacity>
              <TouchableOpacity style={pillBtnStyle} onPress={onCycleSpeed}>
                <Text style={pillTextStyle}>{speed === 'Normal' ? '1x' : speed + 'x'}</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={centerRowStyle}>
            <TouchableOpacity style={btn} onPress={onToggleMute}>
              <Text style={muteStyle}>{muted ? '⊲✕' : '⊲))'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={btn} onPress={() => onSkip(-10)}>
              <Text style={btnText}>↺</Text><Text style={btnSub}>10</Text>
            </TouchableOpacity>
            <TouchableOpacity style={playBtnStyle} onPress={onTogglePlay}>
              <Text style={playIconStyle}>{playing ? '❚❚' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={btn} onPress={() => onSkip(10)}>
              <Text style={btnText}>↻</Text><Text style={btnSub}>10</Text>
            </TouchableOpacity>
          </View>
          <View style={rowStyle}>
            <Text style={timeStyle}>{fmt(currentTime)}</Text>
            <VideoSlider value={currentTime} maximumValue={duration||1}
              onValueChange={onSliderChange} onSlidingStart={onSlidingStart} onSlidingComplete={onSlidingComplete}/>
            <Text style={timeStyle}>{fmt(duration)}</Text>
          </View>
        </View>
      </View>
      </TouchableWithoutFeedback>
    </>
  );
}

const lc = StyleSheet.create({
  overlay: {
    position:'absolute', width:SH, height:SW,
    left:(SW-SH)/2, top:(SH-SW)/2,
    transform:[{rotate:'90deg'}], zIndex:20,
    justifyContent:'flex-end',
    gap: 12,
    paddingBottom:20, paddingHorizontal:24,
    backgroundColor:'rgba(0,0,0,0.0)',
  },
  closeBtn:      { position:'absolute', top:36, right:8, zIndex:30, ...iconBtnStyle },
  modeBtn:       { position:'absolute', bottom:36, right:8, zIndex:30, ...iconBtnStyle },
  controlsGroup: { gap: 10 },
  modeBtnText: { color:'#fff', fontSize:30, fontWeight:'600', textAlign:'center', lineHeight:30 },
  captionBar: {
    position:'absolute', bottom:16, left:0, right:0, zIndex:25,
    alignItems:'center', paddingHorizontal:24,
  },
  captionText: {
    color:'#fff', fontSize:14, fontWeight:'600', textAlign:'center',
    backgroundColor:'rgba(0,0,0,0.6)', paddingHorizontal:12, paddingVertical:4, borderRadius:4,
    overflow:'hidden',
  },
});

// ─── Theater controls ─────────────────────────────────────────────────────────
function TheaterControls({ playing, muted, currentTime, duration, isReal, quality, ccEnabled, speed,
  onClose, onTogglePlay, onSkip, onToggleMute, onCycleQuality, onToggleCC, onCycleSpeed,
  onSliderChange, onSlidingStart, onSlidingComplete, onToggleMode, onDismiss }) {

  const ctrlTop = VIDEO_BOTTOM + 16;

  return (
    <TouchableWithoutFeedback onPress={onDismiss}>
    <View style={StyleSheet.absoluteFill}>
      {/* ✕ and mode toggle just above the video */}
      <View style={[tc.topRow,{top:THEATER_BTNS_TOP}]}>
        <TouchableOpacity style={iconBtnStyle} onPress={onClose}>
          <Text style={iconBtnTextStyle}>✕</Text>
        </TouchableOpacity>
        <TouchableOpacity style={iconBtnStyle} onPress={onToggleMode}>
          <Text style={tc.modeIcon}>⤢</Text>
        </TouchableOpacity>
      </View>

      <View style={[tc.controls,{top:ctrlTop}]}>
        {isReal && (
          <View style={[pillRowStyle, { marginBottom: 12 }]}>
            <TouchableOpacity style={pillBtnStyle} onPress={onCycleQuality}>
              <Text style={pillTextStyle}>{quality}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={pillBtnStyle} onPress={onToggleCC}>
              <Text style={ccEnabled ? pillTextActiveStyle : pillTextStyle}>CC</Text>
            </TouchableOpacity>
            <TouchableOpacity style={pillBtnStyle} onPress={onCycleSpeed}>
              <Text style={pillTextStyle}>{speed === 'Normal' ? '1x' : speed + 'x'}</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={centerRowStyle}>
          <TouchableOpacity style={btn} onPress={onToggleMute}>
            <Text style={muteStyle}>{muted ? '⊲✕' : '⊲))'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={btn} onPress={() => onSkip(-10)}>
            <Text style={btnText}>↺</Text><Text style={btnSub}>10</Text>
          </TouchableOpacity>
          <TouchableOpacity style={playBtnStyle} onPress={onTogglePlay}>
            <Text style={playIconStyle}>{playing ? '❚❚' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={btn} onPress={() => onSkip(10)}>
            <Text style={btnText}>↻</Text><Text style={btnSub}>10</Text>
          </TouchableOpacity>
        </View>
        <View style={[rowStyle,{marginTop:12}]}>
          <Text style={timeStyle}>{fmt(currentTime)}</Text>
          <VideoSlider value={currentTime} maximumValue={duration||1}
            onValueChange={onSliderChange} onSlidingStart={onSlidingStart} onSlidingComplete={onSlidingComplete}/>
          <Text style={timeStyle}>{fmt(duration)}</Text>
        </View>
      </View>
    </View>
    </TouchableWithoutFeedback>
  );
}

const tc = StyleSheet.create({
  topRow:   { position:'absolute', left:20, right:20, flexDirection:'row', justifyContent:'space-between', zIndex:30 },
  controls: { position:'absolute', left:20, right:20, zIndex:20 },
  modeIcon: { color:'#fff', fontSize:30, fontWeight:'600', textAlign:'center', lineHeight:30 },
  captionBox: { position:'absolute', left:20, right:20, zIndex:25, alignItems:'center' },
  captionText: {
    color:'#fff', fontSize:14, fontWeight:'600', textAlign:'center',
    backgroundColor:'rgba(0,0,0,0.55)', paddingHorizontal:12, paddingVertical:6, borderRadius:6, overflow:'hidden',
  },
});

// ─── App ──────────────────────────────────────────────────────────────────────
// ─── Loading overlay ─────────────────────────────────────────────────────────
function LoadingScreen({ opacity }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View style={[ls.container, { opacity }]}>
      <Image source={require('./assets/glumpse-logo.png')} style={ls.logo} resizeMode="contain" />
      <Animated.Text style={[ls.text, { opacity: pulse }]}>LOADING</Animated.Text>
      <Text style={ls.hint}>↻  rotate your phone sideways</Text>
    </Animated.View>
  );
}

const ls = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  logo: { width: SW * 0.66, height: SW * 0.42 },
  text: {
    color: NAVY,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 8,
    marginTop: 40,
  },
  hint: {
    color: NAVY,
    fontSize: 14,
    marginTop: 16,
    opacity: 0.6,
    fontStyle: 'italic',
  },
});

// ─── Welcome / Splash screen ──────────────────────────────────────────────────
function WelcomeScreen({ onEnter }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.15, duration: 1800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 1800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={ws.container}>
      <Image source={require('./assets/glumpse-logo.png')} style={ws.logo} resizeMode="contain" />
      <Text style={ws.tagline}>your glimpse into YouTube</Text>
      <TouchableOpacity onPress={onEnter} activeOpacity={0.8} style={ws.enterWrap}>
        <Animated.Text style={[ws.enter, { opacity: pulse }]}>ENTER</Animated.Text>
      </TouchableOpacity>
    </View>
  );
}

const ws = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    width: SW * 0.66,
    height: SW * 0.42,
    marginBottom: 0,
  },
  tagline: {
    color: NAVY,
    fontSize: 15,
    fontWeight: '400',
    marginTop: 0,
    opacity: 0.8,
    fontStyle: 'italic',
  },
  enterWrap: {
    marginTop: 60,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  enter: {
    color: NAVY,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 8,
  },
});

export default function App() {
  const searchRef  = useRef(null);
  const adRef      = useRef(null);
  const hideTimer  = useRef(null);

  const [hasEntered,      setHasEntered]      = useState(false);
  const [previewing,      setPreviewing]      = useState(false);
  const [playing,         setPlaying]         = useState(true);
  const [muted,           setMuted]           = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [currentTime,     setCurrentTime]     = useState(0);
  const [duration,        setDuration]        = useState(0);
  const [sliding,         setSliding]         = useState(false);
  const [mode,            setMode]            = useState('theater');

  const [premiumMode,    setPremiumMode]    = useState(false); // disabled while testing background playback
  const [adVideoId,      setAdVideoId]      = useState(null);
  const [activeSource,   setActiveSource]   = useState('preview'); // 'preview' | 'real'
  const [adContainerVisible, setAdContainerVisible] = useState(false); // ad webview brought to front (button or real video showing)
  const [upgradeReady,   setUpgradeReady]   = useState(false); // upgrade button is currently offered
  const [swooshKey,      setSwooshKey]      = useState(0); // bump to replay the swoosh animation
  const [quality,        setQuality]        = useState('Auto');
  const [qualityOptions, setQualityOptions] = useState([]);
  const [ccEnabled,      setCcEnabled]      = useState(false);
  const [speed,          setSpeed]          = useState('Normal');

  // Routes a command to whichever video is currently in the foreground.
  // Both WebViews expose the same `window.__activeVid` handle.
  function inject(js) {
    if (activeSource === 'real') adRef.current?.injectJavaScript(cmd(js));
    else searchRef.current?.injectJavaScript(cmd(js));
  }

  function showControls() {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3500);
  }

  function onMessage(e) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'VIDEO_TAPPED') {
        setPlaying(true); setMuted(false); setCurrentTime(0); setDuration(0);
        setControlsVisible(false); setMode('theater');
        setActiveSource('preview');
        setQuality('Auto'); setQualityOptions([]); setCcEnabled(false); setSpeed('Normal');
        setPreviewing(true);
        if (premiumMode) setAdVideoId(msg.videoId);
      }
      if (msg.type === 'PREVIEW_READY') {
        setPlaying(true);
        setTimeout(showControls, 800);
      }
      if (msg.type === 'TIME_UPDATE' && !sliding && activeSource === 'preview') {
        setCurrentTime(msg.currentTime);
        setDuration(msg.duration);
      }
    } catch {}
  }

  function onAdMessage(e) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);

      if (msg.type === 'AD_READY_FOR_TAP') {
        // Ad ended — bring the (still-silent) ad webview to the front, transparent,
        // so its floating upgrade button becomes visible over the still-playing preview
        adRef.current?.injectJavaScript(cmd('window.__adSetMode&&window.__adSetMode("' + mode + '")'));
        setAdContainerVisible(true);
        setUpgradeReady(true);
        setSwooshKey(k => k + 1);
      }

      if (msg.type === 'AD_RESUMED') {
        // Either they never tapped and a new ad started, or a mid-roll interrupted
        // the real video — go back to silent preview-only viewing
        setAdContainerVisible(false);
        setUpgradeReady(false);
        if (activeSource === 'real') {
          searchRef.current?.injectJavaScript(cmd('if(window.__previewVid){window.__previewVid.muted=false;window.__previewVid.play&&window.__previewVid.play().catch(function(){})}'));
          setActiveSource('preview');
        }
      }

      if (msg.type === 'UNMUTE_TAPPED') {
        // User tapped the in-page button — that's a real gesture, audio is now allowed.
        // Pause (not just mute) the preview — no need to keep it decoding/buffering
        // once we've switched over, and it was likely competing for bandwidth with
        // the real video during its quality ramp-up.
        searchRef.current?.injectJavaScript(cmd('if(window.__previewVid){window.__previewVid.muted=true;window.__previewVid.pause();}'));
        setUpgradeReady(false);
        setActiveSource('real');
        showControls();
        // Give the player a moment to fully initialize, then auto-pick the best quality
        setTimeout(() => adRef.current?.injectJavaScript(cmd('window.__adAutoHighestQuality&&window.__adAutoHighestQuality()')), 1200);
      }

      if (msg.type === 'QUALITY_OPTIONS') {
        const resOnly = (msg.options || []).filter(o => /\d{3,4}p/.test(o) || /auto/i.test(o));
        if (resOnly.length) setQualityOptions(resOnly);
        if (msg.selected) setQuality(msg.selected);
      }
      if (msg.type === 'QUALITY_SET' && msg.found) setQuality(msg.level);
      if (msg.type === 'CC_TOGGLED' && msg.available) setCcEnabled(msg.enabled);
      if (msg.type === 'SPEED_SET' && msg.found) setSpeed(msg.level);

      if (msg.type === 'AD_TIME_UPDATE' && !sliding && activeSource === 'real') {
        setCurrentTime(msg.currentTime);
        setDuration(msg.duration);
      }
    } catch {}
  }

  function goBack() {
    searchRef.current?.injectJavaScript(cmd('window.__exitPreview && window.__exitPreview()'));
    setPreviewing(false); setControlsVisible(false); setMode('theater');
    setActiveSource('preview'); setAdVideoId(null);
    setAdContainerVisible(false); setUpgradeReady(false);
    clearTimeout(hideTimer.current);
  }

  function togglePlay() {
    if (playing) inject('if(window.__activeVid) window.__activeVid.pause()');
    else inject('if(window.__activeVid) window.__activeVid.play()');
    setPlaying(p => !p); showControls();
  }

  function toggleMute() {
    const next = !muted;
    inject('if(window.__activeVid) window.__activeVid.muted=' + next);
    setMuted(next); showControls();
  }

  function skip(secs) {
    inject('if(window.__activeVid) window.__activeVid.currentTime+=' + secs);
    showControls();
  }

  function toggleMode() {
    const next = mode === 'landscape' ? 'theater' : 'landscape';
    if (activeSource === 'real') {
      adRef.current?.injectJavaScript(cmd('window.__adSetMode&&window.__adSetMode("' + next + '")'));
    } else {
      searchRef.current?.injectJavaScript(cmd('window.__setVideoMode&&window.__setVideoMode("' + next + '")'));
    }
    setMode(next); showControls();
  }

  function cycleQuality() {
    if (qualityOptions.length === 0) return;
    const i = qualityOptions.indexOf(quality);
    const next = qualityOptions[(i + 1) % qualityOptions.length];
    adRef.current?.injectJavaScript(cmd('window.__adSetQualityByLabel&&window.__adSetQualityByLabel("' + next + '")'));
    showControls();
  }

  function toggleCC() {
    adRef.current?.injectJavaScript(cmd('window.__adToggleCaptions&&window.__adToggleCaptions()'));
    showControls();
  }

  const SPEED_LEVELS = ['0.25', '0.5', '0.75', 'Normal', '1.25', '1.5', '1.75', '2'];
  function cycleSpeed() {
    const i = SPEED_LEVELS.indexOf(speed);
    const next = SPEED_LEVELS[(i + 1) % SPEED_LEVELS.length];
    adRef.current?.injectJavaScript(cmd('window.__adSetSpeed&&window.__adSetSpeed("' + next + '")'));
    showControls();
  }

  function dismissControls() {
    setControlsVisible(false);
    clearTimeout(hideTimer.current);
  }

  const controlProps = {
    playing, muted, currentTime, duration,
    isReal: activeSource === 'real', quality, ccEnabled, speed,
    onClose: goBack, onTogglePlay: togglePlay, onSkip: skip,
    onToggleMute: toggleMute, onToggleMode: toggleMode,
    onCycleQuality: cycleQuality, onToggleCC: toggleCC, onCycleSpeed: cycleSpeed,
    onDismiss: dismissControls,
    onSliderChange: setCurrentTime,
    onSlidingStart: () => setSliding(true),
    onSlidingComplete: val => {
      inject('if(window.__activeVid) window.__activeVid.currentTime=' + val);
      setSliding(false); showControls();
    },
  };

  if (!hasEntered) {
    return <WelcomeScreen onEnter={() => setHasEntered(true)} />;
  }

  return (
    <View style={s.container}>
      {/* Single browse WebView — preview overlay is injected into this */}
      <View style={[s.layer, { zIndex: 1 }]}>
        {!previewing && (
          <View style={s.header}>
            <Image source={require('./assets/glumpse-logo.png')} style={s.headerLogo} resizeMode="contain" />
          </View>
        )}
        <WebView
          ref={searchRef}
          source={{ uri:'https://m.youtube.com' }}
          style={s.webview}
          injectedJavaScriptBeforeContentLoaded={VISIBILITY_SPOOF_JS}
          injectedJavaScript={BROWSE_JS}
          onMessage={onMessage}
          javaScriptEnabled domStorageEnabled
          allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
        />
      </View>

      {/* Hidden "Premium" real-video watcher — loads in background, surfaces once ad ends.
          Background is transparent so the upgrade button can float over the still-playing
          preview before the user taps it. */}
      {previewing && premiumMode && adVideoId && (
        <View style={[s.layer, adContainerVisible ? s.adFront : s.adBehind]}>
          <WebView
            ref={adRef}
            source={{ uri: `https://www.youtube.com/watch?v=${adVideoId}` }}
            userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            style={[s.webview, { backgroundColor: 'transparent' }]}
            injectedJavaScript={AD_JS}
            onMessage={onAdMessage}
            javaScriptEnabled domStorageEnabled
            allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
          />
        </View>
      )}

      {/* Preview overlays — shown on top of both WebViews when previewing.
          While the upgrade button is offered, we drop the touch-absorber so taps
          can reach the button living inside the ad WebView's own DOM. */}
      {previewing && (
        <View
          style={[s.layer, { zIndex: 9 }]}
          pointerEvents={upgradeReady ? 'none' : 'auto'}
          {...(upgradeReady ? {} : { onStartShouldSetResponder: () => true })}
        >
          {!controlsVisible && !upgradeReady && (
            <TouchableWithoutFeedback onPress={showControls}>
              <View style={s.tapTarget}/>
            </TouchableWithoutFeedback>
          )}

          <View style={mode === 'theater' ? s.watermarkTheater : s.watermarkLandscape}>
            <Image source={require('./assets/glumpse-logo.png')} style={s.watermarkLogo} resizeMode="contain" />
          </View>

          {controlsVisible && !upgradeReady && mode === 'landscape' && <LandscapeControls {...controlProps}/>}
          {controlsVisible && !upgradeReady && mode === 'theater'   && <TheaterControls   {...controlProps}/>}

          <Swoosh play={swooshKey} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:'#000' },
  layer: { ...StyleSheet.absoluteFillObject },
  header: {
    backgroundColor: BRAND,
    paddingTop:48, paddingBottom:8,
    flexDirection: 'row', alignItems:'center', justifyContent: 'center',
    borderBottomWidth:2, borderBottomColor: NAVY,
  },
  headerLogo: { height: 52, width: Math.round(SW * 0.66), marginTop: 6 },
  premiumToggle: {
    position: 'absolute', right: 14, bottom: 10,
    alignItems: 'center',
  },
  premiumLabel: { color: NAVY, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 3 },
  toggleTrack: {
    width: 36, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(20,27,65,0.25)',
    justifyContent: 'center', padding: 2,
  },
  toggleTrackOn: { backgroundColor: NAVY },
  toggleThumb: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#fff',
  },
  toggleThumbOn: { transform: [{ translateX: 16 }] },
  webview: { flex:1 },
  tapTarget: { ...StyleSheet.absoluteFillObject, zIndex:10 },
  adFront:  { zIndex: 5, opacity: 1 },
  adBehind: { zIndex: 0, opacity: 0 },
  // Landscape: top-right in portrait = top-left in landscape; shift 10% down in portrait = 10% right in landscape
  watermarkLandscape: {
    position: 'absolute',
    top: Math.round(SH * 0.10),
    right: 14,
    zIndex: 5,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    opacity: 0.8,
    transform: [{ rotate: '90deg' }],
  },
  // Theater: normal portrait top-left
  watermarkTheater: {
    position: 'absolute', top: VIDEO_TOP + 10, left: 14, zIndex: 5,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    opacity: 0.8,
  },
  watermarkLogo: { width: 38, height: 38 },
});
