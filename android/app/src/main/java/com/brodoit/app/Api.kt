package com.brodoit.app

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.TimeZone

/** Minimal JSON client for the Brodoit steps API (register → claim handed to the web app → bulk sync). */
class Api(private val context: Context) {
    private val prefs = Prefs(context)
    private val base: String get() = context.getString(R.string.site_url).trimEnd('/')
    private val appVer: String get() = try { context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0" } catch (e: Exception) { "0" }

    class Result(val code: Int, val body: JSONObject?)

    private fun post(path: String, json: JSONObject, auth: String? = null): Result {
        val url = URL(base + path)
        val c = url.openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.connectTimeout = 15000; c.readTimeout = 20000; c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.setRequestProperty("User-Agent", "Brodoit-Android/$appVer (${Build.MANUFACTURER} ${Build.MODEL}; Android ${Build.VERSION.RELEASE})")
        if (auth != null) c.setRequestProperty("Authorization", auth)
        OutputStreamWriter(c.outputStream, Charsets.UTF_8).use { it.write(json.toString()) }
        val code = c.responseCode
        val stream = if (code in 200..299) c.inputStream else c.errorStream
        val text = try { stream?.bufferedReader()?.use(BufferedReader::readText) ?: "" } catch (e: Exception) { "" }
        c.disconnect()
        val obj = try { if (text.trim().startsWith("{")) JSONObject(text) else null } catch (e: Exception) { null }
        return Result(code, obj)
    }

    /** Registers (or re-registers, refreshing the claim token) this phone. Idempotent for the same id+secret. */
    fun register(): Boolean {
        prefs.ensureIdentity()
        val body = JSONObject()
            .put("device_id", prefs.deviceId).put("secret", prefs.secret)
            .put("platform", "android").put("provider", "android")
            .put("model", (Build.MANUFACTURER + " " + Build.MODEL).take(60))
            .put("os", "Android " + Build.VERSION.RELEASE).put("app_ver", appVer)
        return try {
            val r = post("/api/steps/device/register", body)
            if (r.code == 200 && r.body != null && r.body.optBoolean("ok")) {
                prefs.claimToken = r.body.optString("claim_token", null)
                prefs.lastError = ""
                true
            } else if (r.code == 409) {
                // id taken with another secret (should not happen): start over with a fresh identity
                prefs.deviceId = null; prefs.secret = null; prefs.bound = false; prefs.ensureIdentity()
                false
            } else { prefs.lastError = "register ${r.code}"; false }
        } catch (e: Exception) { Log.w(TAG, "register failed", e); prefs.lastError = "register: ${e.message}"; false }
    }

    /** Sends the last days of hourly counts. Returns true when the server stored them (device is bound). */
    fun bulk(days: List<DayCounts>): Boolean {
        val id = prefs.deviceId ?: return false; val secret = prefs.secret ?: return false
        if (days.isEmpty()) return false
        val arr = JSONArray()
        for (d in days) {
            val hours = JSONArray(); for (h in d.hours) hours.put(h)
            arr.put(JSONObject().put("date", d.date).put("count", d.count).put("hours", hours))
        }
        val body = JSONObject().put("source", "android").put("tz", TimeZone.getDefault().id).put("app_ver", appVer).put("days", arr)
        return try {
            val r = post("/api/steps/bulk", body, "Device $id:$secret")
            when (r.code) {
                200 -> { prefs.bound = true; prefs.lastSyncAt = System.currentTimeMillis(); prefs.lastError = ""; true }
                409 -> { prefs.bound = false; if (prefs.claimToken == null) register(); false } // not bound yet: the web app claims it on next launch
                401, 403 -> { prefs.bound = false; prefs.lastError = "auth ${r.code}"; register(); false }
                else -> { prefs.lastError = "bulk ${r.code}"; false }
            }
        } catch (e: Exception) { Log.w(TAG, "bulk failed", e); prefs.lastError = "bulk: ${e.message}"; false }
    }

    companion object { const val TAG = "BrodoitApi" }
}
