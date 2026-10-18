package com.brodoit.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a reboot or an app update: re-subscribe the step source and put the periodic sync back. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val prefs = Prefs(context)
        if (!prefs.enabled) return
        val pending = goAsync()
        Thread {
            try { StepsEngine.enable(context); Scheduler.ensurePeriodic(context); Scheduler.soon(context, 30L) }
            catch (e: Throwable) { /* ignore */ } finally { pending.finish() }
        }.start()
    }
}
