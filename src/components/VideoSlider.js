import { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { BRAND } from '../theme';

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export default function VideoSlider({
  value,
  maximumValue,
  onValueChange,
  onSlidingStart,
  onSlidingComplete,
}) {
  const trackWidth = useRef(1);
  const propsRef = useRef({});
  propsRef.current = {
    maximumValue: Math.max(Number(maximumValue) || 0, 0),
    onValueChange,
    onSlidingStart,
    onSlidingComplete,
  };

  function valueFromEvent(event) {
    const x = clamp(event.nativeEvent.locationX || 0, 0, trackWidth.current);
    const maximum = propsRef.current.maximumValue;
    return maximum > 0 ? (x / trackWidth.current) * maximum : 0;
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        propsRef.current.onSlidingStart?.();
        propsRef.current.onValueChange?.(valueFromEvent(event));
      },
      onPanResponderMove: (event) => {
        propsRef.current.onValueChange?.(valueFromEvent(event));
      },
      onPanResponderRelease: (event) => {
        propsRef.current.onSlidingComplete?.(valueFromEvent(event));
      },
      onPanResponderTerminate: (event) => {
        propsRef.current.onSlidingComplete?.(valueFromEvent(event));
      },
    }),
  ).current;

  const maximum = Math.max(Number(maximumValue) || 0, 0);
  const ratio = maximum > 0 ? clamp((Number(value) || 0) / maximum, 0, 1) : 0;

  return (
    <View
      style={styles.trackTouchArea}
      onLayout={(event) => {
        trackWidth.current = Math.max(event.nativeEvent.layout.width, 1);
      }}
      accessibilityRole="adjustable"
      accessibilityValue={{
        min: 0,
        max: Math.round(maximum),
        now: Math.round(Number(value) || 0),
      }}
      {...panResponder.panHandlers}
    >
      <View style={styles.track} />
      <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      <View style={[styles.thumb, { left: `${ratio * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  trackTouchArea: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
  },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: BRAND,
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    width: 14,
    height: 14,
    marginTop: -7,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 3,
  },
});
