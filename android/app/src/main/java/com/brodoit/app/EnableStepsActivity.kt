package com.brodoit.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * One native screen: "Count steps automatically" → Allow. Also reachable from the web app via brodoit://enable
 * (the Steps tab's "Turn on" button) when the user skipped it the first time.
 */
class EnableStepsActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var allow: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dp = { v: Float -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt() }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setPadding(dp(28f), dp(40f), dp(28f), dp(32f)); setBackgroundColor(Color.parseColor("#FBF8F3"))
        }
        val icon = ImageView(this).apply { setImageResource(R.drawable.ic_launcher_foreground); layoutParams = LinearLayout.LayoutParams(dp(160f), dp(160f)) }
        val title = TextView(this).apply {
            text = getString(R.string.enable_title); textSize = 28f; setTypeface(null, Typeface.BOLD); gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#17141F")); setPadding(0, dp(18f), 0, dp(10f))
        }
        val body = TextView(this).apply {
            text = getString(R.string.enable_body); textSize = 16f; gravity = Gravity.CENTER; setTextColor(Color.parseColor("#6F697D")); setLineSpacing(0f, 1.3f)
        }
        status = TextView(this).apply { textSize = 14f; gravity = Gravity.CENTER; setTextColor(Color.parseColor("#C2410C")); setPadding(0, dp(12f), 0, 0); visibility = View.GONE }
        allow = Button(this).apply {
            text = getString(R.string.enable_allow); textSize = 17f; setTypeface(null, Typeface.BOLD); setTextColor(Color.WHITE); isAllCaps = false
            background = GradientDrawable().apply { cornerRadius = dp(18f).toFloat(); setColor(Color.parseColor("#FF5A36")) }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56f)).apply { topMargin = dp(28f) }
            setOnClickListener { ask() }
        }
        val later = TextView(this).apply {
            text = getString(R.string.enable_later); textSize = 15f; gravity = Gravity.CENTER; setTextColor(Color.parseColor("#8A8496")); setPadding(0, dp(18f), 0, 0)
            setOnClickListener { openApp() }
        }
        root.addView(icon); root.addView(title); root.addView(body); root.addView(status); root.addView(allow); root.addView(later)
        setContentView(root)
        if (StepsEngine.hasPermission(this)) finishEnable()
    }

    private fun ask() {
        if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.ACTIVITY_RECOGNITION), 7)
        } else finishEnable()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 7) return
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) finishEnable()
        else { status.text = getString(R.string.enable_denied); status.visibility = View.VISIBLE }
    }

    private fun finishEnable() {
        allow.isEnabled = false; status.text = getString(R.string.enable_working); status.visibility = View.VISIBLE
        status.setTextColor(Color.parseColor("#009E89"))
        Thread {
            try {
                StepsEngine.enable(this)
                val api = Api(this); val prefs = Prefs(this)
                if (prefs.claimToken == null && !prefs.bound) api.register()
                Scheduler.ensurePeriodic(this)
                Scheduler.soon(this, 20L, 75L, 240L) // land a first sync right after the web app claims this phone
            } catch (e: Throwable) { /* the periodic job retries */ }
            runOnUiThread { openApp() }
        }.start()
    }

    private fun openApp() {
        val i = Intent(this, LauncherActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        startActivity(i); finish()
    }
}
