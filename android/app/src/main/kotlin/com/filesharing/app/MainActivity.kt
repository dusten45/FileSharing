package com.filesharing.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.filesharing.app.databinding.ActivityMainBinding
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.android.gms.common.api.ApiException
import com.google.android.material.snackbar.Snackbar
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val viewModel: MainViewModel by viewModels()

    // Google 로그인 결과 처리
    private val googleSignInLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
            try {
                task.getResult(ApiException::class.java)
                // 로그인 성공 — 별도 처리 불필요 (GoogleAuthManager가 계정 캐시)
            } catch (e: ApiException) {
                Snackbar.make(binding.root, getString(R.string.sign_in_failed), Snackbar.LENGTH_LONG).show()
            }
        } else {
            Snackbar.make(binding.root, getString(R.string.sign_in_required), Snackbar.LENGTH_LONG).show()
        }
    }

    // 파일 선택 (ACTION_OPEN_DOCUMENT)
    private val filePicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri != null) {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            viewModel.processFile(uri)
        }
    }

    // 폴더 선택 (ACTION_OPEN_DOCUMENT_TREE)
    private val folderPicker = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri: Uri? ->
        if (uri != null) {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            viewModel.processFolder(uri)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)

        // Google 로그인 상태 확인
        if (!viewModel.authManager.isSignedIn()) {
            googleSignInLauncher.launch(viewModel.authManager.getSignInIntent())
        }

        binding.btnPickFile.setOnClickListener {
            filePicker.launch(arrayOf("*/*"))
        }

        binding.btnPickFolder.setOnClickListener {
            folderPicker.launch(null)
        }

        // 로그 텍스트 업데이트
        lifecycleScope.launch {
            viewModel.logText.collectLatest { text ->
                binding.tvLog.text = text
                // 자동 스크롤
                binding.scrollLog.post {
                    binding.scrollLog.fullScroll(android.view.View.FOCUS_DOWN)
                }
            }
        }

        // 버튼 활성화/비활성화
        lifecycleScope.launch {
            viewModel.isBusy.collectLatest { busy ->
                binding.btnPickFile.isEnabled = !busy
                binding.btnPickFolder.isEnabled = !busy
                binding.btnPickFile.text = if (busy) getString(R.string.btn_pick_file_busy)
                                           else getString(R.string.btn_pick_file)
                binding.btnPickFolder.text = if (busy) getString(R.string.btn_pick_folder_busy)
                                             else getString(R.string.btn_pick_folder)
            }
        }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.menu_main, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_settings -> {
                startActivity(Intent(this, SettingsActivity::class.java))
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }
}
