/** Keep browser page magnification disabled across WebView initialization and attachment without consuming touch events. */
package io.github.txsdx.zhinexus.ui

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import java.util.WeakHashMap

/** Native page zoom stays disabled; scrolling, selection, app fonts and JavaScript graph zoom keep their own behavior. */
object PageGestures {
    private val observed = WeakHashMap<WebView, Boolean>()

    private fun disable(webView: WebView) {
        webView.settings.setSupportZoom(false)
        webView.settings.builtInZoomControls = false
        webView.settings.displayZoomControls = false
    }

    /** Reapply after initialization and attachment so subsequent engine defaults cannot restore browser pinch zoom. */
    fun apply(webView: WebView) {
        disable(webView)
        webView.post { disable(webView) }
        if (observed.put(webView, true) != true) {
            webView.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                override fun onViewAttachedToWindow(view: View) {
                    disable(webView)
                    webView.post { disable(webView) }
                }
                override fun onViewDetachedFromWindow(view: View) {}
            })
        }
    }

    /** Refresh every app-owned WebView after Activity resume, including a recreated or late-attached view. */
    fun refresh(root: View) {
        if (root is WebView) apply(root)
        if (root is ViewGroup) {
            for (index in 0 until root.childCount) refresh(root.getChildAt(index))
        }
    }
}
