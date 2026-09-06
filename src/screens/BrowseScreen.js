import { useRef } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import AppHeader from '../components/AppHeader';
import PreviewControls from '../components/PreviewControls';
import usePreviewPlayer from '../hooks/usePreviewPlayer';
import { BRAND, GLUMPSE_LOGO } from '../theme';
import { BROWSE_INJECTION } from '../webview/browseInjection';

export default function BrowseScreen() {
  const webViewRef = useRef(null);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const preview = usePreviewPlayer(webViewRef);
  const watermarkSize = isLandscape ? 40 : 44;

  return (
    <View style={styles.container}>
      <StatusBar
        style={preview.previewing ? 'light' : 'dark'}
        hidden={preview.previewing}
      />

      <View style={styles.browserLayer}>
        {!preview.previewing && <AppHeader />}
        <WebView
          ref={webViewRef}
          source={{ uri: 'https://m.youtube.com' }}
          style={styles.webView}
          injectedJavaScript={BROWSE_INJECTION}
          onMessage={preview.handleMessage}
          onError={(event) => {
            preview.reportNativeError(event.nativeEvent.description);
          }}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          setSupportMultipleWindows={false}
        />
      </View>

      {preview.previewing && (
        <View style={styles.previewLayer}>
          {!preview.controlsVisible && (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={preview.showControls}
              accessibilityRole="button"
              accessibilityLabel="Show playback controls"
            />
          )}

          <View
            pointerEvents="none"
            style={[
              styles.watermark,
              {
                width: watermarkSize,
                height: watermarkSize,
                borderRadius: watermarkSize / 2,
                top: isLandscape ? 12 : 18,
                left: isLandscape ? 18 : 14,
              },
            ]}
          >
            <Image
              source={GLUMPSE_LOGO}
              style={{ width: watermarkSize - 6, height: watermarkSize - 6 }}
              resizeMode="contain"
            />
          </View>

          {preview.controlsVisible && (
            <PreviewControls
              {...preview.player}
              mode={preview.mode}
              onClose={preview.closePreview}
              onTogglePlay={preview.togglePlay}
              onSkip={preview.skip}
              onToggleMute={preview.toggleMute}
              onToggleMode={preview.toggleMode}
              onDismiss={preview.hideControls}
              onSliderChange={preview.changeSlider}
              onSlidingStart={preview.startSliding}
              onSlidingComplete={preview.completeSliding}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  browserLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  webView: {
    flex: 1,
    backgroundColor: '#000000',
  },
  previewLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  watermark: {
    position: 'absolute',
    zIndex: 2,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    opacity: 0.82,
  },
});
