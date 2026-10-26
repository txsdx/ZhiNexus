/** Android package installation uses a private FileProvider and the normal unknown-sources consent flow. */
package io.github.txsdx.zhinexus.updates

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

/** The native downloader supplies only a verified, app-private APK path. */
@InvokeArg
class InstallApkArgs { lateinit var path: String }

/** Expose package installation without arbitrary URLs, shell execution or filesystem access. */
@TauriPlugin
class UpdateInstaller(private val activity: Activity) : Plugin(activity) {
    /** Request Android's explicit per-application install authorization when needed. */
    @Command
    fun installApk(invoke: Invoke) {
        try {
            verifiedPath(invoke)
            if (!activity.packageManager.canRequestPackageInstalls()) {
                val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
                startActivityForResult(invoke, intent, "afterPermission")
            } else launchInstaller(invoke)
        } catch (e: Exception) { invoke.reject(e.message ?: "Unable to start Android update") }
    }
    /** Continue the same user-requested installation after the system permission activity returns. */
    @ActivityCallback
    fun afterPermission(invoke: Invoke, result: ActivityResult) {
        if (!activity.packageManager.canRequestPackageInstalls()) { invoke.reject("Package installation permission was not granted"); return }
        try { launchInstaller(invoke) } catch (e: Exception) { invoke.reject(e.message ?: "Unable to install APK") }
    }
    /** Restrict FileProvider exposure to APK files in this application's verified update directory. */
    private fun verifiedPath(invoke: Invoke): File {
        val file = File(invoke.parseArgs(InstallApkArgs::class.java).path).canonicalFile
        require(file.exists() && file.extension == "apk" && file.parentFile?.name == "updates")
        require(file.toPath().startsWith(File(activity.applicationInfo.dataDir).canonicalFile.toPath()))
        return file
    }
    /** Grant the system package installer temporary read access to this one verified APK. */
    private fun launchInstaller(invoke: Invoke) {
        val file = verifiedPath(invoke)
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".zhinexus-updates", file)
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
        invoke.resolve()
    }
}

/** Keep the updater provider distinct from any provider contributed by other Tauri plugins. */
class UpdateFileProvider : FileProvider()
