package com.brodoit.app

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.HandlerThread
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Fallback step source: the hardware step counter keeps counting in the sensor hub while the phone sleeps.
 * Each sample reads the cumulative count since boot and spreads the delta since the previous sample over the
 * hours in between; daily totals are exact, hourly bars are approximate when the phone was dozing.
 */
object SensorProvider {
    fun sample(c: Context) {
        val sm = c.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
        val sensor = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return
        val latch = CountDownLatch(1); var value = -1f
        val thread = HandlerThread("bd-steps").apply { start() }
        val listener = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) { if (value < 0f) { value = e.values[0]; latch.countDown() } }
            override fun onAccuracyChanged(s: Sensor?, a: Int) {}
        }
        try {
            sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL, android.os.Handler(thread.looper))
            latch.await(6, TimeUnit.SECONDS)
        } catch (e: Throwable) { /* ignore */ } finally {
            try { sm.unregisterListener(listener) } catch (e: Throwable) {}
            thread.quitSafely()
        }
        if (value < 0f) return
        record(c, value, System.currentTimeMillis())
    }

    @Synchronized
    fun record(c: Context, total: Float, now: Long) {
        val p = Prefs(c)
        val bootAt = now - SystemClock.elapsedRealtime()
        val rebooted = p.scBootAt == 0L || Math.abs(bootAt - p.scBootAt) > 120_000L
        val last = p.scLast; val lastAt = p.scLastAt
        var delta = 0
        if (last >= 0f && !rebooted && total >= last) delta = (total - last).toInt()
        else if (rebooted && last >= 0f) delta = total.toInt() // counter restarted at boot: everything since is new
        if (delta > 0 && lastAt > 0L) spread(p, delta, lastAt, now)
        p.scLast = total; p.scLastAt = now; p.scBootAt = bootAt
    }

    private fun spread(p: Prefs, delta: Int, from: Long, to: Long) {
        val zone = ZoneId.systemDefault()
        val days = JSONObject(p.scDays)
        // cap attribution to the last 36 h: a very old baseline shouldn't paint steps across a week
        val start = Math.max(from, to - 36L * 3600_000L)
        var cursor = start; var left = delta
        while (cursor < to && left > 0) {
            val t = Instant.ofEpochMilli(cursor).atZone(zone)
            val hourEnd = Math.min(to, t.withMinute(0).withSecond(0).withNano(0).plusHours(1).toInstant().toEpochMilli())
            val share = if (hourEnd >= to) left else Math.min(left, Math.round(delta.toDouble() * (hourEnd - cursor) / Math.max(1L, to - start)).toInt())
            val key = t.toLocalDate().toString()
            val arr = days.optJSONArray(key) ?: JSONArray().also { a -> repeat(24) { a.put(0) }; days.put(key, a) }
            arr.put(t.hour, arr.optInt(t.hour) + share)
            left -= share; cursor = hourEnd
        }
        // keep only the last 5 days
        val keep = (0..4).map { LocalDate.now(zone).minusDays(it.toLong()).toString() }.toSet()
        val names = days.keys().asSequence().toList()
        for (k in names) if (k !in keep) days.remove(k)
        p.scDays = days.toString()
    }

    fun days(c: Context, n: Int): List<DayCounts> {
        val zone = ZoneId.systemDefault(); val store = JSONObject(Prefs(c).scDays); val out = ArrayList<DayCounts>()
        for (i in (n - 1) downTo 0) {
            val key = LocalDate.now(zone).minusDays(i.toLong()).toString()
            val arr = store.optJSONArray(key); val hours = IntArray(24)
            if (arr != null) for (h in 0 until 24) hours[h] = arr.optInt(h)
            out.add(DayCounts(key, hours))
        }
        return out
    }
}
