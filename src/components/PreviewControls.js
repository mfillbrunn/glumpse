import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import VideoSlider from './VideoSlider';
import { BRAND, WHITE } from '../theme';

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${minutes}:${remainder < 10 ? '0' : ''}${remainder}`;
}

function RoundButton({ label, onPress, accessibilityLabel, emphasized = false, size = 56 }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [
        styles.roundButton,
        emphasized && styles.playButton,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, emphasized && styles.playText]}>{label}</Text>
    </Pressable>
  );
}

export default function PreviewControls({
  playing,
  muted,
  currentTime,
  duration,
  buffering,
  ended,
  error,
  mode,
  onClose,
  onTogglePlay,
  onSkip,
  onToggleMute,
  onToggleMode,
  onDismiss,
  onSliderChange,
  onSlidingStart,
  onSlidingComplete,
}) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const compact = height < 500 || width < 360;
  const regularButtonSize = compact ? 46 : 56;
  const playButtonSize = compact ? 58 : 70;
  const horizontalPadding = isLandscape ? 36 : 20;
  const bottomOffset = isLandscape ? 18 : 32;
  const topOffset = isLandscape ? 14 : 26;
  const rowGap = compact ? 12 : (isLandscape ? 30 : 18);
  const timelineWidth = isLandscape
    ? Math.min(width - horizontalPadding * 2, 820)
    : width - horizontalPadding * 2;
  const statusText = error
    ? 'PLAYER ERROR'
    : buffering
      ? 'BUFFERING'
      : ended
        ? 'PREVIEW ENDED'
        : null;

  return (
    <View style={styles.root}>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.dismissTarget]}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Hide playback controls"
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.scrim]} />

      <View
        pointerEvents="box-none"
        style={[styles.topRow, { top: topOffset, left: horizontalPadding, right: horizontalPadding }]}
      >
        <RoundButton
          label="X"
          onPress={onClose}
          accessibilityLabel="Close preview"
          size={regularButtonSize}
        />
        <Pressable
          onPress={onToggleMode}
          accessibilityRole="button"
          accessibilityLabel={mode === 'fit' ? 'Fill the screen' : 'Fit the whole video'}
          style={({ pressed }) => [
            styles.modeButton,
            { height: regularButtonSize, minWidth: regularButtonSize + 18 },
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.modeText}>{mode === 'fit' ? 'FILL' : 'FIT'}</Text>
        </Pressable>
      </View>

      <View pointerEvents="box-none" style={styles.centerArea}>
        {statusText && <Text style={styles.statusText}>{statusText}</Text>}
        <View style={[styles.controlRow, { gap: rowGap }]}> 
          <RoundButton
            label={muted ? 'UNMUTE' : 'MUTE'}
            onPress={onToggleMute}
            accessibilityLabel={muted ? 'Unmute preview' : 'Mute preview'}
            size={regularButtonSize}
          />
          <RoundButton
            label="-10"
            onPress={() => onSkip(-10)}
            accessibilityLabel="Go back 10 seconds"
            size={regularButtonSize}
          />
          <RoundButton
            label={playing ? 'PAUSE' : 'PLAY'}
            onPress={onTogglePlay}
            accessibilityLabel={playing ? 'Pause preview' : 'Play preview'}
            emphasized
            size={playButtonSize}
          />
          <RoundButton
            label="+10"
            onPress={() => onSkip(10)}
            accessibilityLabel="Go forward 10 seconds"
            size={regularButtonSize}
          />
        </View>
      </View>

      <View
        pointerEvents="box-none"
        style={[
          styles.timelineRow,
          {
            left: (width - timelineWidth) / 2,
            bottom: bottomOffset,
            width: timelineWidth,
          },
        ]}
      >
        <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
        <VideoSlider
          value={currentTime}
          maximumValue={duration || 1}
          onValueChange={onSliderChange}
          onSlidingStart={onSlidingStart}
          onSlidingComplete={onSlidingComplete}
        />
        <Text style={styles.timeText}>{formatTime(duration)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dismissTarget: {
    zIndex: 1,
  },
  scrim: {
    zIndex: 0,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  topRow: {
    position: 'absolute',
    zIndex: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  centerArea: {
    zIndex: 3,
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 10,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  playButton: {
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  buttonText: {
    color: WHITE,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  playText: {
    fontSize: 12,
  },
  pressed: {
    opacity: 0.55,
  },
  modeButton: {
    paddingHorizontal: 14,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  modeText: {
    color: WHITE,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  statusText: {
    color: BRAND,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    overflow: 'hidden',
  },
  timelineRow: {
    position: 'absolute',
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  timeText: {
    color: WHITE,
    fontSize: 12,
    fontWeight: '600',
    minWidth: 38,
    textAlign: 'center',
  },
});
