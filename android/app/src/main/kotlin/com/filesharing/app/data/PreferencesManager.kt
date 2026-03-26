package com.filesharing.app.data

import android.content.Context
import android.content.SharedPreferences

class PreferencesManager(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("filesharing_prefs", Context.MODE_PRIVATE)

    var webhookUrl: String
        get() = prefs.getString(KEY_WEBHOOK_URL, "") ?: ""
        set(value) = prefs.edit().putString(KEY_WEBHOOK_URL, value).apply()

    var sizeLimitMb: Float
        get() = prefs.getFloat(KEY_SIZE_LIMIT_MB, DEFAULT_SIZE_LIMIT_MB)
        set(value) = prefs.edit().putFloat(KEY_SIZE_LIMIT_MB, value).apply()

    companion object {
        private const val KEY_WEBHOOK_URL = "discord_webhook_url"
        private const val KEY_SIZE_LIMIT_MB = "size_limit_mb"
        const val DEFAULT_SIZE_LIMIT_MB = 10f
    }
}
