package com.brodoit.app

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context

/** Background sync schedule: a persisted periodic job (survives reboots) plus one-off nudges after launch/enable. */
object Scheduler {
    private const val PERIODIC_ID = 1001
    private const val ONE_OFF_BASE = 2000

    fun ensurePeriodic(c: Context) {
        val js = c.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        if (js.allPendingJobs.any { it.id == PERIODIC_ID }) return
        val info = JobInfo.Builder(PERIODIC_ID, ComponentName(c, SyncJobService::class.java))
            .setPeriodic(30L * 60_000L, 15L * 60_000L)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .build()
        js.schedule(info)
    }

    /** Runs a sync soon. Several delays so that one lands right after the web app has claimed the device. */
    fun soon(c: Context, vararg delaysSec: Long) {
        val js = c.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        val ds = if (delaysSec.isEmpty()) longArrayOf(2L) else delaysSec
        ds.forEachIndexed { i, d ->
            val info = JobInfo.Builder(ONE_OFF_BASE + i, ComponentName(c, SyncJobService::class.java))
                .setMinimumLatency(d * 1000L)
                .setOverrideDeadline((d + 120L) * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build()
            js.schedule(info)
        }
    }
}
