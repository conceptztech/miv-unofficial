package expo.modules.mivdevice

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Rational
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.annotation.ChecksSdkIntAtLeast
import androidx.annotation.RequiresApi
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference
import java.util.WeakHashMap

class MivDeviceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MivDevice")
    Events("pipChanged", "download")
    OnCreate {
      Handler(Looper.getMainLooper()).post {
        MivDeviceController.reset(appContext.currentActivity)
        MivDeviceController.module = WeakReference(this@MivDeviceModule)
      }
    }
    OnDestroy {
      Handler(Looper.getMainLooper()).post {
        if (MivDeviceController.module?.get() === this@MivDeviceModule) {
          MivDeviceController.reset(appContext.currentActivity)
          MivDeviceController.module = null
        }
      }
    }
    AsyncFunction("setVideoPlaying") { playing: Boolean ->
      MivDeviceController.playing = playing
      MivDeviceController.update(appContext.currentActivity)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("setBlocked") { blocked: Boolean ->
      MivDeviceController.blocked = blocked
      MivDeviceController.update(appContext.currentActivity)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("attach") {
      MivDeviceController.attach(appContext.currentActivity)
    }.runOnQueue(Queues.MAIN)
  }
}

object MivDeviceController {
  var module: WeakReference<MivDeviceModule>? = null
  var playing = false
  var blocked = false
  private var enteringPip = false
  private var cachedWebView: WeakReference<WebView>? = null
  private val attached = WeakHashMap<WebView, Boolean>()

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) for (index in 0 until view.childCount) {
      findWebView(view.getChildAt(index))?.let { return it }
    }
    return null
  }

  private fun webView(activity: Activity): WebView? {
    cachedWebView?.get()?.let {
      if (it.isAttachedToWindow && it.rootView === activity.window.decorView) return it
    }
    return findWebView(activity.window.decorView)?.also { cachedWebView = WeakReference(it) }
  }

  fun attach(activity: Activity?) {
    if (activity == null) return
    val webView = webView(activity) ?: return
    if (attached.put(webView, true) != null) return
    // This also catches PDFs whose type is known only after receiving headers.
    webView.setDownloadListener { url, _, _, _, _ ->
      if (url.startsWith("https://", true) || url.startsWith("http://", true)) {
        module?.get()?.sendEvent("download", mapOf("url" to url))
      }
    }
  }

  @ChecksSdkIntAtLeast(api = Build.VERSION_CODES.O)
  private fun supported(activity: Activity) = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
    activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

  @RequiresApi(Build.VERSION_CODES.O)
  private fun params(activity: Activity): PictureInPictureParams {
    val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
    val rect = Rect()
    if (webView(activity)?.getGlobalVisibleRect(rect) == true) builder.setSourceRectHint(rect)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setAutoEnterEnabled((playing || enteringPip) && !blocked).setSeamlessResizeEnabled(true)
    }
    return builder.build()
  }

  fun update(activity: Activity?) {
    if (activity == null || activity.isDestroyed || !supported(activity)) return
    try { activity.setPictureInPictureParams(params(activity)) } catch (_: RuntimeException) { }
  }

  fun reset(activity: Activity?) {
    playing = false
    blocked = false
    enteringPip = false
    update(activity)
    cachedWebView = null
  }

  fun onUserLeaveHint(activity: Activity) {
    if (!supported(activity) || !playing || blocked || activity.isInPictureInPictureMode) return
    enteringPip = true
    webView(activity)?.evaluateJavascript("window.MivBridge && window.MivBridge.preparePip(true); true;", null)
    activity.window.decorView.postDelayed({
      if (!activity.isDestroyed && !activity.isInPictureInPictureMode) {
        enteringPip = false
        update(activity)
      }
    }, 1000)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      try { activity.enterPictureInPictureMode(params(activity)) } catch (_: RuntimeException) { }
    }
  }

  fun onModeChanged(activity: Activity, active: Boolean) {
    enteringPip = false
    webView(activity)?.evaluateJavascript("window.MivBridge && window.MivBridge.setPip($active); true;", null)
    module?.get()?.sendEvent("pipChanged", mapOf("active" to active))
  }

  fun onStop(activity: Activity) {
    if (playing && (!supported(activity) || !activity.isInPictureInPictureMode || activity.isFinishing)) {
      webView(activity)?.evaluateJavascript("window.MivBridge && window.MivBridge.pauseMedia(); true;", null)
      playing = false
      enteringPip = false
      update(activity)
    }
  }
}
