/** Disable browser page magnification without consuming touches used by scrolling, selection or diagrams. */
package io.github.txsdx.zhinexus.ui

import android.webkit.WebView

/** Keep application pages at their responsive scale; graph zoom remains controlled by its JavaScript canvas. */
object PageGestures {
    /** Apply before the newly created WebView receives user gestures. */
    fun apply(webView: WebView) {
        webView.settings.setSupportZoom(false)
        webView.settings.builtInZoomControls = false
        webView.settings.displayZoomControls = false
    }
}
