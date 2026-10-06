package com.vega.fork

import android.content.Intent
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import android.net.Uri

// Lets JS ask Android to persist read access to a document picked via the
// Storage Access Framework (ACTION_OPEN_DOCUMENT), so a content:// uri
// handed back by expo-document-picker (with copyToCacheDirectory: false)
// stays readable after the app process is killed and restarted, without
// duplicating the underlying file. Without this call, the grant Android
// hands out for a freshly-picked document is not guaranteed to survive
// past the current process lifetime.
class UriPermissionModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "UriPermissionModule"

  @ReactMethod
  fun takePersistableUriPermission(uriString: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
      reactContext.contentResolver.takePersistableUriPermission(uri, flags)
      promise.resolve(true)
    } catch (error: Exception) {
      // Non-fatal: some uris (e.g. already-persisted, or from providers
      // that don't support persistable grants) will throw here. The
      // caller should treat this as "couldn't guarantee persistence"
      // rather than a hard failure.
      promise.reject("TAKE_PERSISTABLE_URI_PERMISSION_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun releasePersistableUriPermission(uriString: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
      reactContext.contentResolver.releasePersistableUriPermission(uri, flags)
      promise.resolve(true)
    } catch (error: Exception) {
      // Already released, or never held — safe to ignore from JS's
      // perspective, so resolve false instead of rejecting.
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun getPersistedUriPermissions(promise: Promise) {
    try {
      val uris = reactContext.contentResolver.persistedUriPermissions.map { it.uri.toString() }
      promise.resolve(com.facebook.react.bridge.Arguments.fromList(uris))
    } catch (error: Exception) {
      promise.reject("GET_PERSISTED_URI_PERMISSIONS_FAILED", error.message, error)
    }
  }
}

class UriPermissionPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(UriPermissionModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
