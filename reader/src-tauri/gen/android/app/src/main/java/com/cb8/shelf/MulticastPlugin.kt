/**
 * DISC-5: WifiManager.MulticastLock for LAN mDNS discovery.
 *
 * Android filters multicast at the Wi-Fi driver unless a MulticastLock is held.
 * mdns-sd is pure Rust and cannot touch WifiManager, so this Kotlin plugin is
 * the bridge: Rust calls `acquire` when a browse window opens and `release`
 * when it closes (15 s auto-stop or connect-screen unmount). Holding the lock
 * for the whole app life would waste battery — scope it to the browse only.
 *
 * Permissions (`CHANGE_WIFI_MULTICAST_STATE`, `ACCESS_NETWORK_STATE`) are in
 * AndroidManifest.xml. Neither is a runtime permission.
 */
package com.cb8.shelf

import android.app.Activity
import android.content.Context
import android.net.wifi.WifiManager
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin
class MulticastPlugin(private val activity: Activity) : Plugin(activity) {
    private var multicastLock: WifiManager.MulticastLock? = null

    @Command
    fun acquire(invoke: Invoke) {
        try {
            val held = multicastLock?.isHeld == true
            if (held) {
                invoke.resolve()
                return
            }
            val wifi =
                activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            if (wifi == null) {
                Log.w(TAG, "WifiManager unavailable — mDNS browse will stay empty")
                invoke.resolve()
                return
            }
            val lock = wifi.createMulticastLock(LOCK_TAG)
            // Not reference-counted: one acquire / one release per browse window.
            lock.setReferenceCounted(false)
            lock.acquire()
            multicastLock = lock
            Log.d(TAG, "MulticastLock acquired for mDNS browse")
            invoke.resolve()
        } catch (e: Exception) {
            // Discovery is never a hard error path — empty browse + manual entry.
            Log.w(TAG, "Failed to acquire MulticastLock: ${e.message}")
            invoke.resolve()
        }
    }

    @Command
    fun release(invoke: Invoke) {
        try {
            val lock = multicastLock
            multicastLock = null
            if (lock != null && lock.isHeld) {
                lock.release()
                Log.d(TAG, "MulticastLock released")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to release MulticastLock: ${e.message}")
            multicastLock = null
        }
        invoke.resolve()
    }

    companion object {
        private const val TAG = "cb8.multicast"
        private const val LOCK_TAG = "cb8-mdns"
    }
}
