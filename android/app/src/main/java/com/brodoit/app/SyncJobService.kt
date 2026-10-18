package com.brodoit.app

import android.app.job.JobParameters
import android.app.job.JobService
import android.util.Log

/** Reads the last days from the step source and posts them to the Brodoit server. */
class SyncJobService : JobService() {
    @Volatile private var thread: Thread? = null

    override fun onStartJob(params: JobParameters): Boolean {
        val t = Thread {
            var retry = false
            try { retry = !Sync.run(applicationContext) } catch (e: Throwable) { Log.w("BrodoitSync", "sync crashed", e); retry = true }
            jobFinished(params, retry)
        }
        thread = t; t.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean { thread?.interrupt(); return true }
}

object Sync {
    /** @return true when nothing is left to do (bound and synced, or not enabled); false asks the scheduler to retry. */
    fun run(c: android.content.Context): Boolean {
        val prefs = Prefs(c)
        if (!StepsEngine.hasPermission(c)) return true
        if (!prefs.enabled) StepsEngine.enable(c)
        val api = Api(c)
        if (prefs.deviceId == null || prefs.claimToken == null && !prefs.bound) { if (!api.register()) return false }
        val days = StepsEngine.read(c)
        if (days.isEmpty()) return true
        val ok = api.bulk(days)
        Scheduler.ensurePeriodic(c)
        // unbound (409) is not an error worth retrying: the next app launch hands the claim to the web app
        return ok || !prefs.bound
    }
}
