package com.filesharing.app

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.filesharing.app.auth.GoogleAuthManager
import com.filesharing.app.data.PreferencesManager
import com.filesharing.app.upload.DiscordUploader
import com.filesharing.app.upload.DriveUploader
import com.filesharing.app.upload.FileProcessor
import com.filesharing.app.util.FileUtils
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val context = application.applicationContext
    val authManager = GoogleAuthManager(context)
    private val prefs = PreferencesManager(context)

    private val discordUploader = DiscordUploader(context)
    private val driveUploader = DriveUploader(context, authManager)
    private val fileProcessor = FileProcessor(context, discordUploader, driveUploader)

    private val _logText = MutableStateFlow("로그가 여기에 표시됩니다…")
    val logText: StateFlow<String> = _logText.asStateFlow()

    private val _isBusy = MutableStateFlow(false)
    val isBusy: StateFlow<Boolean> = _isBusy.asStateFlow()

    private val _progressText = MutableStateFlow<String?>(null)
    val progressText: StateFlow<String?> = _progressText.asStateFlow()

    fun appendLog(message: String) {
        _logText.value = _logText.value + "\n" + message
    }

    fun clearLog() {
        _logText.value = ""
    }

    fun processFile(uri: Uri) {
        if (_isBusy.value) return
        _isBusy.value = true
        clearLog()
        viewModelScope.launch {
            try {
                fileProcessor.processFile(
                    uri = uri,
                    webhookUrl = prefs.webhookUrl,
                    sizeLimitMb = prefs.sizeLimitMb,
                    log = ::appendLog
                )
            } finally {
                _isBusy.value = false
            }
        }
    }

    fun processFiles(uris: List<Uri>) {
        if (_isBusy.value) return
        _isBusy.value = true
        clearLog()
        viewModelScope.launch {
            try {
                val total = uris.size
                uris.forEachIndexed { index, uri ->
                    val filename = FileUtils.getFilename(getApplication(), uri)
                    if (total > 1) {
                        _progressText.value = "[${index + 1}/$total] $filename"
                        appendLog("\n────────────────────")
                        appendLog("[${index + 1}/$total] $filename")
                    }
                    fileProcessor.processFile(uri, prefs.webhookUrl, prefs.sizeLimitMb, ::appendLog)
                }
            } finally {
                _progressText.value = null
                _isBusy.value = false
            }
        }
    }

    fun processFolder(treeUri: Uri) {
        if (_isBusy.value) return
        _isBusy.value = true
        clearLog()
        viewModelScope.launch {
            try {
                fileProcessor.processFolder(
                    treeUri = treeUri,
                    webhookUrl = prefs.webhookUrl,
                    sizeLimitMb = prefs.sizeLimitMb,
                    log = ::appendLog
                )
            } finally {
                _isBusy.value = false
            }
        }
    }
}
