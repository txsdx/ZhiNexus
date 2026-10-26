/** Keep the WebView inside Android system bars and cutouts while retaining keyboard inset dispatch. */
package io.github.txsdx.zhinexus.ui

import android.app.Activity
import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** Apply native view padding instead of relying on WebView CSS safe-area support. */
object SystemInsets {
    /** Consume only system-bar and cutout insets; keyboard and gesture events still reach descendants. */
    fun apply(activity: Activity) {
        val root = activity.findViewById<View>(android.R.id.content)
        val left = root.paddingLeft
        val top = root.paddingTop
        val right = root.paddingRight
        val bottom = root.paddingBottom
        val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(types)
            view.setPadding(left + bars.left, top + bars.top, right + bars.right, bottom + bars.bottom)
            WindowInsetsCompat.Builder(insets)
                .setInsets(types, Insets.NONE)
                .setInsetsIgnoringVisibility(types, Insets.NONE)
                .setDisplayCutout(null)
                .build()
        }
        root.post { ViewCompat.requestApplyInsets(root) }
    }
}
