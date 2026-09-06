import {
  Image,
  Platform,
  StatusBar as NativeStatusBar,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { BRAND, GLUMPSE_LOGO, NAVY } from '../theme';

export default function AppHeader() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const logoWidth = Math.min(width * (isLandscape ? 0.42 : 0.66), 360);
  const logoHeight = Math.max(38, Math.min(58, logoWidth * 0.34));
  const androidTop = NativeStatusBar.currentHeight || 24;
  const topPadding = Platform.OS === 'android'
    ? androidTop + (isLandscape ? 2 : 8)
    : (isLandscape ? 12 : 44);

  return (
    <View style={[styles.header, { paddingTop: topPadding }]}> 
      <Image
        source={GLUMPSE_LOGO}
        style={{ width: logoWidth, height: logoHeight }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: NAVY,
  },
});
