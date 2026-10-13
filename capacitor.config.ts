import type { CapacitorConfig } from '@capacitor/cli'

// The Android app is the same web build, packed inside an APK and shown in a
// full-screen WebView. See README, "Android app".
const config: CapacitorConfig = {
  appId: 'io.github.erikfazlla.sunspot',
  appName: 'Sunspot',
  webDir: 'dist',
}

export default config
