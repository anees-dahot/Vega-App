package com.vega.fork
import com.reactnative.googlecast.api.RNGCCastContext
import com.zoontek.rnbootsplash.RNBootSplash

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  private fun getBootTheme(): Int {
    val launchedAlias = intent?.component?.className?.substringAfterLast('.')
    val selectedIcon = getSharedPreferences("vega_launcher", MODE_PRIVATE)
      .getString("icon", null) ?: when (launchedAlias) {
      "LauncherWhite" -> "white"
      "LauncherTomato" -> "tomato"
      "LauncherGray" -> "gray"
      "LauncherBlue" -> "blue"
      "LauncherLavender" -> "lavender"
      else -> "white"
    }
    return when (selectedIcon) {
      "tomato" -> R.style.BootTheme_Tomato
      "gray" -> R.style.BootTheme_Gray
      "blue" -> R.style.BootTheme_Blue
      "lavender" -> R.style.BootTheme_Lavender
      else -> R.style.BootTheme_White
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin bootsplash-init - expo prebuild (DO NOT MODIFY) sync-f0f7dbc46f1d82498f47676b4197e1949dc7790f
    val bootTheme = getBootTheme()
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
      splashScreen.setSplashScreenTheme(bootTheme)
    }
    RNBootSplash.init(this, bootTheme)
    // @generated end bootsplash-init
    super.onCreate(null)
// @generated begin react-native-google-cast-onCreate - expo prebuild (DO NOT MODIFY) sync-489050f2bf9933a98bbd9d93137016ae14c22faa
    RNGCCastContext.getSharedInstance(this)
// @generated end react-native-google-cast-onCreate
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
