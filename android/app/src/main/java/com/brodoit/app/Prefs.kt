package com.brodoit.app

import android.content.Context
import android.content.SharedPreferences
import java.security.SecureRandom

/** Tiny settings store: device identity, pairing state, provider choice, sensor baseline. */
class Prefs(context: Context) {
    private val sp: SharedPreferences = context.applicationContext.getSharedPreferences("brodoit", Context.MODE_PRIVATE)

    var deviceId: String?
        get() = sp.getString("device_id", null)
        set(v) = sp.edit().putString("device_id", v).apply()
    var secret: String?
        get() = sp.getString("secret", null)
        set(v) = sp.edit().putString("secret", v).apply()
    var claimToken: String?
        get() = sp.getString("claim_token", null)
        set(v) = sp.edit().putString("claim_token", v).apply()
    /** true once the server accepted a bulk sync for this device (it is bound to an account). */
    var bound: Boolean
        get() = sp.getBoolean("bound", false)
        set(v) = sp.edit().putBoolean("bound", v).apply()
    var asked: Boolean
        get() = sp.getBoolean("asked", false)
        set(v) = sp.edit().putBoolean("asked", v).apply()
    var enabled: Boolean
        get() = sp.getBoolean("enabled", false)
        set(v) = sp.edit().putBoolean("enabled", v).apply()
    /** "recording" (Play services Recording API) or "sensor" (hardware step counter). */
    var provider: String
        get() = sp.getString("provider", "") ?: ""
        set(v) = sp.edit().putString("provider", v).apply()
    var lastSyncAt: Long
        get() = sp.getLong("last_sync_at", 0L)
        set(v) = sp.edit().putLong("last_sync_at", v).apply()
    var lastError: String
        get() = sp.getString("last_error", "") ?: ""
        set(v) = sp.edit().putString("last_error", v).apply()

    // hardware step-counter baseline (cumulative since boot)
    var scLast: Float
        get() = sp.getFloat("sc_last", -1f)
        set(v) = sp.edit().putFloat("sc_last", v).apply()
    var scLastAt: Long
        get() = sp.getLong("sc_last_at", 0L)
        set(v) = sp.edit().putLong("sc_last_at", v).apply()
    var scBootAt: Long
        get() = sp.getLong("sc_boot_at", 0L)
        set(v) = sp.edit().putLong("sc_boot_at", v).apply()
    var scDays: String
        get() = sp.getString("sc_days", "{}") ?: "{}"
        set(v) = sp.edit().putString("sc_days", v).apply()

    fun ensureIdentity() {
        if (deviceId == null) deviceId = randomToken(16)
        if (secret == null) secret = randomToken(32)
    }

    companion object {
        private const val ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        fun randomToken(bytes: Int): String {
            val rnd = SecureRandom(); val sb = StringBuilder()
            repeat(bytes * 2) { sb.append(ALPHABET[rnd.nextInt(ALPHABET.length)]) }
            return sb.toString()
        }
    }
}
