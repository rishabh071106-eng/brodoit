package com.brodoit.app

/** One local calendar day of steps: total plus 24 hourly buckets (local time). */
class DayCounts(val date: String, val hours: IntArray) {
    val count: Int get() = hours.sum()
}
