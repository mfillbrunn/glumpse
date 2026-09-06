import { useCallback, useEffect, useRef, useState } from 'react';

const INITIAL_PLAYER = Object.freeze({
  playing: false,
  muted: true,
  currentTime: 0,
  duration: 0,
  buffering: false,
  ended: false,
  playbackRate: 1,
  error: null,
});

function freshPlayer() {
  return { ...INITIAL_PLAYER };
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function commandScript(command) {
  const payload = JSON.stringify(command).replace(/</g, '\\u003c');
  return `window.__glumpsePlayerCommand && window.__glumpsePlayerCommand(${payload}); true;`;
}

function errorMessage(error) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message) return error.message;
  return 'The preview player reported an error.';
}

export default function usePreviewPlayer(webViewRef) {
  const [previewing, setPreviewing] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [mode, setMode] = useState('fit');
  const [player, setPlayer] = useState(freshPlayer);
  const hideTimer = useRef(null);
  const readyTimer = useRef(null);
  const sliding = useRef(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const clearReadyTimer = useCallback(() => {
    if (readyTimer.current) {
      clearTimeout(readyTimer.current);
      readyTimer.current = null;
    }
  }, []);

  const sendCommand = useCallback((command) => {
    webViewRef.current?.injectJavaScript(commandScript(command));
  }, [webViewRef]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
  }, []);

  const hideControls = useCallback(() => {
    clearHideTimer();
    setControlsVisible(false);
  }, [clearHideTimer]);

  useEffect(() => {
    clearHideTimer();
    if (!previewing || !controlsVisible) return undefined;

    if (!player.playing || player.buffering || player.error) {
      return undefined;
    }

    hideTimer.current = setTimeout(() => {
      setControlsVisible(false);
      hideTimer.current = null;
    }, 3500);

    return clearHideTimer;
  }, [
    clearHideTimer,
    controlsVisible,
    player.buffering,
    player.error,
    player.playing,
    previewing,
  ]);

  useEffect(() => () => {
    clearHideTimer();
    clearReadyTimer();
  }, [clearHideTimer, clearReadyTimer]);

  const handleMessage = useCallback((event) => {
    let message;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch (parseError) {
      console.warn('Glumpse received a non-JSON WebView message.', parseError);
      return;
    }

    switch (message.type) {
      case 'VIDEO_TAPPED':
        clearReadyTimer();
        sliding.current = false;
        setMode('fit');
        setPlayer(freshPlayer());
        setControlsVisible(false);
        setPreviewing(true);
        break;

      case 'PREVIEW_READY':
        clearReadyTimer();
        readyTimer.current = setTimeout(() => {
          setControlsVisible(true);
          readyTimer.current = null;
        }, 250);
        break;

      case 'PLAYER_STATE':
        setPlayer((previous) => ({
          ...previous,
          playing: Boolean(message.playing),
          muted: Boolean(message.muted),
          currentTime: sliding.current
            ? previous.currentTime
            : Math.max(0, finiteNumber(message.currentTime)),
          duration: Math.max(0, finiteNumber(message.duration)),
          buffering: Boolean(message.buffering),
          ended: Boolean(message.ended),
          playbackRate: finiteNumber(message.playbackRate, 1),
          error: message.error
            ? errorMessage(message.error)
            : ['play', 'playing', 'canplay', 'canplaythrough'].includes(message.event)
              ? null
              : previous.error,
        }));
        break;

      case 'MODE_CHANGED':
        if (message.mode === 'fit' || message.mode === 'fill') {
          setMode(message.mode);
        }
        break;

      case 'PREVIEW_FAILED':
      case 'PLAYER_ERROR':
        clearHideTimer();
        setPlayer((previous) => ({
          ...previous,
          playing: false,
          buffering: false,
          error: errorMessage(message.error || message.message),
        }));
        setControlsVisible(true);
        break;

      case 'PREVIEW_CLOSED':
        clearHideTimer();
        clearReadyTimer();
        sliding.current = false;
        setPreviewing(false);
        setControlsVisible(false);
        setMode('fit');
        setPlayer(freshPlayer());
        break;

      default:
        break;
    }
  }, [clearHideTimer, clearReadyTimer]);

  const closePreview = useCallback(() => {
    clearHideTimer();
    clearReadyTimer();
    sliding.current = false;
    sendCommand({ type: 'EXIT' });
    setPreviewing(false);
    setControlsVisible(false);
    setMode('fit');
    setPlayer(freshPlayer());
  }, [clearHideTimer, clearReadyTimer, sendCommand]);

  const togglePlay = useCallback(() => {
    sendCommand({ type: 'TOGGLE_PLAY' });
    showControls();
  }, [sendCommand, showControls]);

  const toggleMute = useCallback(() => {
    sendCommand({ type: 'TOGGLE_MUTE' });
    showControls();
  }, [sendCommand, showControls]);

  const skip = useCallback((seconds) => {
    sendCommand({ type: 'SEEK_BY', seconds: finiteNumber(seconds) });
    showControls();
  }, [sendCommand, showControls]);

  const toggleMode = useCallback(() => {
    setMode((current) => {
      const next = current === 'fit' ? 'fill' : 'fit';
      sendCommand({ type: 'SET_MODE', mode: next });
      return next;
    });
    showControls();
  }, [sendCommand, showControls]);

  const startSliding = useCallback(() => {
    sliding.current = true;
    showControls();
  }, [showControls]);

  const changeSlider = useCallback((value) => {
    const next = Math.max(0, finiteNumber(value));
    setPlayer((previous) => ({ ...previous, currentTime: next }));
  }, []);

  const completeSliding = useCallback((value) => {
    const next = Math.max(0, finiteNumber(value));
    sendCommand({ type: 'SEEK_TO', seconds: next });
    sliding.current = false;
    setPlayer((previous) => ({ ...previous, currentTime: next }));
    showControls();
  }, [sendCommand, showControls]);

  const reportNativeError = useCallback((message) => {
    clearHideTimer();
    setPlayer((previous) => ({
      ...previous,
      playing: false,
      buffering: false,
      error: message || 'The YouTube browser failed to load.',
    }));
    if (previewing) setControlsVisible(true);
  }, [clearHideTimer, previewing]);

  return {
    previewing,
    controlsVisible,
    mode,
    player,
    handleMessage,
    reportNativeError,
    showControls,
    hideControls,
    closePreview,
    togglePlay,
    toggleMute,
    skip,
    toggleMode,
    startSliding,
    changeSlider,
    completeSliding,
  };
}
