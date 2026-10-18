package com.brodoit.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.fitness.FitnessLocal
import com.google.android.gms.fitness.LocalRecordingClient
import com.google.android.gms.fitness.data.LocalDataType
import com.google.android.gms.fitness.data.LocalField
import com.google.android.gms.fitness.request.LocalDataReadRequest
import com.google.android.gms.tasks.Tasks
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Picks a step source and reads the last days as hourly buckets.
 *  • "recording": Google Play services Recording API on mobile (LocalRecordingClient). Play services keeps
 *    counting while the app is closed and stores up to 10 days; no Google account, no battery cost.
 *  • "sensor": the phone's hardware step counter, sampled whenever a sync runs (see SensorProvider).
 * Both need only the Physical activity permission.
 */
object StepsEngine {
    private const val TAG = "BrodoitSteps"
    const val DAYS = 3

    fun hasPermission(c: Context): Boolean =
        android.os.Build.VERSION.SDK_INT < 29 ||
            c.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED

    fun playServicesOk(c: Context): Boolean = try {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(c, LocalRecordingClient.LOCAL_RECORDING_CLIENT_MIN_VERSION_CODE) == ConnectionResult.SUCCESS
    } catch (e: Throwable) { false }

    /** Called after the permission is granted (and again on boot / upgrade): subscribe and remember the provider. */
    fun enable(c: Context): String {
        val prefs = Prefs(c)
        if (!hasPermission(c)) return ""
        var provider = "sensor"
        if (playServicesOk(c)) {
            try {
                Tasks.await(FitnessLocal.getLocalRecordingClient(c).subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA), 10, TimeUnit.SECONDS)
                provider = "recording"
            } catch (e: Throwable) { Log.w(TAG, "recording subscribe failed, using sensor", e) }
        }
        SensorProvider.sample(c) // establish the sensor baseline either way (cheap, and the fallback if Play services goes away)
        prefs.provider = provider; prefs.enabled = true
        return provider
    }

    fun read(c: Context): List<DayCounts> {
        val prefs = Prefs(c)
        if (!hasPermission(c)) return emptyList()
        if (prefs.provider == "recording") {
            try { return readRecording(c) } catch (e: Throwable) { Log.w(TAG, "recording read failed, falling back to sensor", e) }
        }
        SensorProvider.sample(c)
        return SensorProvider.days(c, DAYS)
    }

    private fun readRecording(c: Context): List<DayCounts> {
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val start = today.minusDays((DAYS - 1).toLong()).atStartOfDay(zone)
        val end = today.plusDays(1).atStartOfDay(zone)
        val req = LocalDataReadRequest.Builder()
            .aggregate(LocalDataType.TYPE_STEP_COUNT_DELTA)
            .bucketByTime(1, TimeUnit.HOURS)
            .setTimeRange(start.toEpochSecond(), end.toEpochSecond(), TimeUnit.SECONDS)
            .build()
        val resp = Tasks.await(FitnessLocal.getLocalRecordingClient(c).readData(req), 20, TimeUnit.SECONDS)
        val byDay = LinkedHashMap<String, IntArray>()
        for (i in 0 until DAYS) byDay[today.minusDays((DAYS - 1 - i).toLong()).toString()] = IntArray(24)
        for (bucket in resp.buckets) {
            val t = Instant.ofEpochMilli(bucket.getStartTime(TimeUnit.MILLISECONDS)).atZone(zone)
            val day = t.toLocalDate().toString(); val hour = t.hour
            var steps = 0
            for (ds in bucket.dataSets) for (dp in ds.dataPoints) {
                try { steps += dp.getValue(LocalField.FIELD_STEPS).asInt() } catch (e: Throwable) { /* other fields */ }
            }
            byDay[day]?.let { it[hour] = it[hour] + steps }
        }
        return byDay.map { DayCounts(it.key, it.value) }
    }
}
