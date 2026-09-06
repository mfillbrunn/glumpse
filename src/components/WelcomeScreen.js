import { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { BRAND, GLUMPSE_LOGO, NAVY } from '../theme';

export default function WelcomeScreen({ onEnter }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const logoWidth = Math.min(width * (isLandscape ? 0.48 : 0.68), 440);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.2,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Image
        source={GLUMPSE_LOGO}
        style={{ width: logoWidth, height: logoWidth * 0.64 }}
        resizeMode="contain"
      />
      <Text style={styles.tagline}>your glimpse into YouTube</Text>
      <TouchableOpacity
        onPress={onEnter}
        activeOpacity={0.8}
        style={[styles.enterWrap, isLandscape && styles.enterWrapLandscape]}
        accessibilityRole="button"
        accessibilityLabel="Enter Glumpse"
      >
        <Animated.Text style={[styles.enter, { opacity: pulse }]}>ENTER</Animated.Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  tagline: {
    color: NAVY,
    fontSize: 15,
    fontWeight: '400',
    opacity: 0.8,
    fontStyle: 'italic',
  },
  enterWrap: {
    marginTop: 56,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  enterWrapLandscape: {
    marginTop: 24,
  },
  enter: {
    color: NAVY,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 8,
  },
});
