export const BROWSE_INJECTION = String.raw`
(function() {
  if (window.__glumpseBrowseInjected) {
    if (window.__glumpsePlayerCommand) {
      window.__glumpsePlayerCommand({ type: 'SYNC_STATE' });
    }
    return;
  }

  window.__glumpseBrowseInjected = true;
  window.__glumpseMode = 'fit';
  window.__glumpseUserControlledPlayback = false;
  window.__glumpseUserControlledMute = false;
  window.__glumpseBuffering = false;

  function post(message) {
    if (!window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  function safeNumber(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function playerError(video) {
    if (!video || !video.error) return null;
    return {
      code: video.error.code || 0,
      message: video.error.message || 'HTML video error',
    };
  }

  function syncPlayerState(eventName) {
    var video = window.__previewVid;
    if (!video) return;
    post({
      type: 'PLAYER_STATE',
      event: eventName || 'sync',
      playing: !video.paused && !video.ended,
      paused: !!video.paused,
      muted: !!video.muted || video.volume === 0,
      volume: safeNumber(video.volume, 0),
      currentTime: safeNumber(video.currentTime, 0),
      duration: safeNumber(video.duration, 0),
      buffering: !!window.__glumpseBuffering,
      ended: !!video.ended,
      seeking: !!video.seeking,
      readyState: video.readyState || 0,
      playbackRate: safeNumber(video.playbackRate, 1),
      error: playerError(video),
    });
  }

  function detachPlayerEvents() {
    if (window.__previewDetachEvents) {
      window.__previewDetachEvents();
      window.__previewDetachEvents = null;
    }
    if (window.__previewStateInterval) {
      clearInterval(window.__previewStateInterval);
      window.__previewStateInterval = null;
    }
  }

  function attachPlayerEvents(video) {
    detachPlayerEvents();
    var events = [
      'play',
      'pause',
      'playing',
      'waiting',
      'stalled',
      'canplay',
      'canplaythrough',
      'ended',
      'volumechange',
      'timeupdate',
      'durationchange',
      'loadedmetadata',
      'ratechange',
      'seeking',
      'seeked',
      'error',
      'emptied'
    ];
    var lastTimeUpdate = 0;

    function onPlayerEvent(event) {
      if (event.type === 'waiting' || event.type === 'stalled') {
        window.__glumpseBuffering = true;
      } else if (
        event.type === 'playing' ||
        event.type === 'canplay' ||
        event.type === 'canplaythrough' ||
        event.type === 'pause' ||
        event.type === 'ended' ||
        event.type === 'error'
      ) {
        window.__glumpseBuffering = false;
      }

      if (event.type === 'timeupdate') {
        var now = Date.now();
        if (now - lastTimeUpdate < 180) return;
        lastTimeUpdate = now;
      }
      syncPlayerState(event.type);
    }

    events.forEach(function(eventName) {
      video.addEventListener(eventName, onPlayerEvent);
    });

    window.__previewDetachEvents = function() {
      events.forEach(function(eventName) {
        video.removeEventListener(eventName, onPlayerEvent);
      });
    };

    window.__previewStateInterval = setInterval(function() {
      syncPlayerState('heartbeat');
    }, 500);
  }

  function applyVideoLayout() {
    var overlay = window.__previewOverlay;
    var video = window.__previewVid;
    if (!overlay || !video) return;

    var objectFit = window.__glumpseMode === 'fill' ? 'cover' : 'contain';
    overlay.style.cssText = [
      'position:fixed !important',
      'top:0 !important',
      'right:0 !important',
      'bottom:0 !important',
      'left:0 !important',
      'width:100vw !important',
      'height:100vh !important',
      'overflow:hidden !important',
      'background:#000 !important',
      'z-index:99991 !important'
    ].join(';');

    video.setAttribute('style', [
      'display:block !important',
      'position:absolute !important',
      'top:0 !important',
      'right:0 !important',
      'bottom:0 !important',
      'left:0 !important',
      'width:100vw !important',
      'height:100vh !important',
      'max-width:none !important',
      'max-height:none !important',
      'object-fit:' + objectFit + ' !important',
      'transform:none !important',
      'transform-origin:center center !important',
      'margin:0 !important',
      'padding:0 !important',
      'background:#000 !important'
    ].join(';'));

    post({
      type: 'VIEWPORT_CHANGED',
      width: window.innerWidth || 0,
      height: window.innerHeight || 0,
      orientation: (window.innerWidth || 0) > (window.innerHeight || 0)
        ? 'landscape'
        : 'portrait'
    });
  }

  function delayedLayout() {
    applyVideoLayout();
    setTimeout(applyVideoLayout, 80);
    setTimeout(applyVideoLayout, 250);
  }

  window.addEventListener('resize', delayedLayout);
  window.addEventListener('orientationchange', delayedLayout);

  function clearStartAssistance() {
    if (window.__previewStartInterval) {
      clearInterval(window.__previewStartInterval);
      window.__previewStartInterval = null;
    }
  }

  window.__exitPreview = function() {
    clearStartAssistance();
    detachPlayerEvents();

    if (window.__previewVid) {
      try {
        window.__previewVid.pause();
        window.__previewVid.muted = true;
      } catch (ignore) {}
    }

    if (window.__previewOverlay) window.__previewOverlay.remove();
    if (window.__previewBackdrop) window.__previewBackdrop.remove();
    if (window.__previewDimmer) window.__previewDimmer.remove();

    window.__previewVid = null;
    window.__activeVid = null;
    window.__previewOverlay = null;
    window.__previewBackdrop = null;
    window.__previewDimmer = null;
    window.__glumpseBuffering = false;
    window.__glumpseUserControlledPlayback = false;
    window.__glumpseUserControlledMute = false;
    post({ type: 'PREVIEW_CLOSED' });
  };

  function commandFailure(command, error) {
    post({
      type: 'PLAYER_ERROR',
      command: command && command.type,
      message: error && error.message ? error.message : String(error || 'Player command failed')
    });
  }

  function clampTime(video, value) {
    var next = Math.max(0, safeNumber(Number(value), 0));
    if (safeNumber(video.duration, 0) > 0) {
      next = Math.min(next, video.duration);
    }
    return next;
  }

  window.__glumpsePlayerCommand = function(command) {
    command = command || {};

    if (command.type === 'EXIT') {
      window.__exitPreview();
      return;
    }

    if (command.type === 'SET_MODE') {
      window.__glumpseMode = command.mode === 'fill' ? 'fill' : 'fit';
      applyVideoLayout();
      post({ type: 'MODE_CHANGED', mode: window.__glumpseMode });
      return;
    }

    var video = window.__previewVid;
    if (!video) {
      if (command.type !== 'SYNC_STATE') {
        post({ type: 'PLAYER_ERROR', message: 'No preview player is active.' });
      }
      return;
    }

    try {
      if (command.type === 'TOGGLE_PLAY') {
        window.__glumpseUserControlledPlayback = true;
        if (video.paused || video.ended) {
          if (video.ended) video.currentTime = 0;
          var playResult = video.play();
          if (playResult && playResult.catch) {
            playResult.catch(function(error) {
              commandFailure(command, error);
              syncPlayerState('play-rejected');
            });
          }
        } else {
          video.pause();
        }
      } else if (command.type === 'TOGGLE_MUTE') {
        window.__glumpseUserControlledMute = true;
        var effectivelyMuted = video.muted || video.volume === 0;
        video.muted = !effectivelyMuted;
        if (effectivelyMuted) video.volume = 1;
      } else if (command.type === 'SEEK_BY') {
        video.currentTime = clampTime(video, video.currentTime + Number(command.seconds || 0));
      } else if (command.type === 'SEEK_TO') {
        video.currentTime = clampTime(video, Number(command.seconds || 0));
      } else if (command.type === 'SYNC_STATE') {
        syncPlayerState('requested');
        return;
      }
    } catch (error) {
      commandFailure(command, error);
    }

    setTimeout(function() {
      syncPlayerState('command-' + (command.type || 'unknown'));
    }, 0);
  };

  function zoomVideo(video) {
    window.__previewVid = video;
    window.__activeVid = video;
    window.__glumpseMode = 'fit';
    window.__glumpseBuffering = false;
    window.__glumpseUserControlledPlayback = false;
    window.__glumpseUserControlledMute = false;

    var backdrop = document.createElement('div');
    backdrop.style.cssText = [
      'position:fixed',
      'top:0',
      'right:0',
      'bottom:0',
      'left:0',
      'background:#000',
      'z-index:99990'
    ].join(';');
    window.__previewBackdrop = backdrop;
    document.body.appendChild(backdrop);

    var overlay = document.createElement('div');
    window.__previewOverlay = overlay;
    document.body.appendChild(overlay);
    overlay.appendChild(video);

    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.controls = false;
    applyVideoLayout();
    attachPlayerEvents(video);

    function assistStart() {
      if (!window.__previewVid) return;
      if (!window.__glumpseUserControlledMute) {
        video.muted = false;
        if (video.volume === 0) video.volume = 1;
      }
      if (!window.__glumpseUserControlledPlayback && video.paused) {
        var result = video.play();
        if (result && result.catch) result.catch(function() {});
      }
    }

    assistStart();
    var attempts = 0;
    clearStartAssistance();
    window.__previewStartInterval = setInterval(function() {
      assistStart();
      attempts += 1;
      if (attempts >= 12) clearStartAssistance();
    }, 250);

    post({ type: 'PREVIEW_READY' });
    syncPlayerState('preview-ready');
  }

  function findVideoLink(target) {
    var link = target.closest && target.closest('a[href*="watch?v="]');
    if (link) return link;

    var item = target.closest && target.closest(
      'ytm-media-item,ytm-compact-video-renderer,ytm-rich-item-renderer,.compact-media-item'
    );
    if (!item) return null;

    var thumbnail = target.closest && target.closest(
      '[class*="thumbnail"] a,[class*="image"] a,.compact-media-item-image a'
    );
    if (thumbnail && thumbnail.href && thumbnail.href.indexOf('watch?v=') !== -1) {
      return thumbnail;
    }

    var anchors = item.querySelectorAll('a[href*="watch?v="]');
    for (var index = 0; index < anchors.length; index += 1) {
      if (anchors[index].contains(target)) return anchors[index];
    }
    return anchors.length ? anchors[0] : null;
  }

  function findPreviewVideo(container) {
    var local = container && container.querySelector('video');
    if (local) return local;

    var videos = document.querySelectorAll('video');
    for (var index = 0; index < videos.length; index += 1) {
      var rectangle = videos[index].getBoundingClientRect();
      if (rectangle.width > 0 && rectangle.height > 0) return videos[index];
    }
    return videos.length ? videos[0] : null;
  }

  document.addEventListener('click', function(event) {
    if (window.__previewVid) return;

    var link = findVideoLink(event.target);
    if (!link) return;

    var href = link.href || link.getAttribute('href') || '';
    var match = href.match(/[?&]v=([^&]+)/);
    if (!match) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    try {
      var audioUnlock = new Audio();
      var unlockResult = audioUnlock.play();
      if (unlockResult && unlockResult.catch) unlockResult.catch(function() {});
    } catch (ignore) {}

    var container = link.closest(
      'ytm-media-item,ytm-compact-video-renderer,ytm-rich-item-renderer,.compact-media-item'
    );
    if (!container) container = link.parentElement;

    post({ type: 'VIDEO_TAPPED', videoId: match[1] });

    var dimmer = document.createElement('div');
    dimmer.style.cssText = [
      'position:fixed',
      'top:0',
      'right:0',
      'bottom:0',
      'left:0',
      'background:#000',
      'z-index:99989',
      'opacity:0',
      'transition:opacity 0.25s ease',
      'pointer-events:none'
    ].join(';');
    window.__previewDimmer = dimmer;
    document.body.appendChild(dimmer);
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        dimmer.style.opacity = '1';
      });
    });

    setTimeout(function() {
      if (container && container.scrollIntoView) {
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      ['mouseenter', 'mouseover', 'pointerenter', 'pointermove'].forEach(function(name) {
        try {
          container.dispatchEvent(new MouseEvent(name, {
            bubbles: true,
            cancelable: true
          }));
        } catch (ignore) {}
      });
    }, 200);

    var tries = 0;
    var poll = setInterval(function() {
      var video = findPreviewVideo(container);
      if (video) {
        clearInterval(poll);
        setTimeout(function() {
          zoomVideo(video);
        }, 400);
        return;
      }

      tries += 1;
      if (tries > 50) {
        clearInterval(poll);
        if (window.__previewDimmer) {
          window.__previewDimmer.remove();
          window.__previewDimmer = null;
        }
        post({
          type: 'PREVIEW_FAILED',
          message: 'YouTube did not create a preview video for this item.'
        });
      }
    }, 300);
  }, true);
})();
true;
`;
