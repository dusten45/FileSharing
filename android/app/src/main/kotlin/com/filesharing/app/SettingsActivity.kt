package com.filesharing.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.filesharing.app.data.PreferencesManager
import com.filesharing.app.databinding.ActivitySettingsBinding
import com.google.android.material.snackbar.Snackbar

class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private lateinit var prefs: PreferencesManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = PreferencesManager(this)

        setSupportActionBar(binding.toolbar)
        binding.toolbar.setNavigationOnClickListener { finish() }

        loadSettings()

        binding.btnSave.setOnClickListener { saveSettings() }
    }

    private fun loadSettings() {
        binding.etWebhookUrl.setText(prefs.webhookUrl)
        val limit = prefs.sizeLimitMb
        binding.etSizeLimit.setText(if (limit == PreferencesManager.DEFAULT_SIZE_LIMIT_MB) "" else limit.toString())
    }

    private fun saveSettings() {
        val url = binding.etWebhookUrl.text?.toString()?.trim() ?: ""
        val limitText = binding.etSizeLimit.text?.toString()?.trim() ?: ""

        if (url.isNotEmpty() && !url.startsWith("https://discord.com/api/webhooks/")) {
            binding.etWebhookUrl.error = "올바른 Discord Webhook URL을 입력해주세요."
            return
        }

        prefs.webhookUrl = url

        val limit = limitText.toFloatOrNull()
        if (limitText.isNotEmpty() && (limit == null || limit <= 0)) {
            binding.etSizeLimit.error = "0보다 큰 숫자를 입력해주세요."
            return
        }
        prefs.sizeLimitMb = limit ?: PreferencesManager.DEFAULT_SIZE_LIMIT_MB

        Snackbar.make(binding.root, getString(R.string.settings_saved), Snackbar.LENGTH_SHORT).show()
    }
}
