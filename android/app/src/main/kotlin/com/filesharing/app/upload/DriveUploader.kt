package com.filesharing.app.upload

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import com.filesharing.app.auth.GoogleAuthManager
import com.google.api.client.googleapis.extensions.android.gms.auth.GoogleAccountCredential
import com.google.api.client.http.InputStreamContent
import com.google.api.client.http.javanet.NetHttpTransport
import com.google.api.client.json.gson.GsonFactory
import com.google.api.services.drive.Drive
import com.google.api.services.drive.DriveScopes
import com.google.api.services.drive.model.File
import com.google.api.services.drive.model.Permission
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class DriveUploader(
    private val context: Context,
    private val authManager: GoogleAuthManager
) {

    private fun buildDriveService(): Drive {
        val account = authManager.getSignedInAccount()
            ?: error("Google 계정이 로그인되지 않았습니다.")
        val credential = GoogleAccountCredential.usingOAuth2(
            context,
            listOf(DriveScopes.DRIVE_FILE)
        )
        credential.selectedAccount = account.account
        return Drive.Builder(
            NetHttpTransport(),
            GsonFactory.getDefaultInstance(),
            credential
        )
            .setApplicationName("FileSharing")
            .build()
    }

    /**
     * 파일을 Google Drive에 업로드하고 공개 공유 링크를 반환합니다.
     */
    suspend fun uploadFile(
        uri: Uri,
        filename: String,
        log: (String) -> Unit
    ): String = withContext(Dispatchers.IO) {
        val drive = buildDriveService()
        val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"

        log("☁️ Google Drive에 업로드 중: $filename")

        val inputStream = context.contentResolver.openInputStream(uri)
            ?: error("파일을 열 수 없습니다: $filename")

        val mediaContent = InputStreamContent(mimeType, inputStream)

        val metadata = File().apply {
            name = filename
        }

        val file = drive.files().create(metadata, mediaContent)
            .setFields("id")
            .execute()

        val fileId = file.id

        // 공개 읽기 권한 설정
        val permission = Permission().apply {
            type = "anyone"
            role = "reader"
        }
        drive.permissions().create(fileId, permission).execute()

        "https://drive.google.com/file/d/$fileId/view"
    }

    /**
     * 폴더를 Google Drive에 재귀적으로 업로드하고 공개 공유 링크를 반환합니다.
     * 폴더 구조가 보존됩니다.
     */
    suspend fun uploadFolder(
        treeUri: Uri,
        folderName: String,
        log: (String) -> Unit
    ): String = withContext(Dispatchers.IO) {
        val drive = buildDriveService()
        val rootDocFile = DocumentFile.fromTreeUri(context, treeUri)
            ?: error("폴더를 열 수 없습니다.")

        log("☁️ Google Drive에 폴더 업로드 중: $folderName")

        val rootFolderId = createDriveFolder(drive, folderName, null)
        uploadDocumentFolder(drive, rootDocFile, rootFolderId, log)

        // 루트 폴더 공개 권한 설정
        val permission = Permission().apply {
            type = "anyone"
            role = "reader"
        }
        drive.permissions().create(rootFolderId, permission).execute()

        "https://drive.google.com/drive/folders/$rootFolderId"
    }

    private fun createDriveFolder(drive: Drive, name: String, parentId: String?): String {
        val metadata = File().apply {
            this.name = name
            mimeType = "application/vnd.google-apps.folder"
            if (parentId != null) {
                parents = listOf(parentId)
            }
        }
        return drive.files().create(metadata).setFields("id").execute().id
    }

    private fun uploadDocumentFolder(
        drive: Drive,
        folder: DocumentFile,
        parentDriveFolderId: String,
        log: (String) -> Unit
    ) {
        folder.listFiles().forEach { file ->
            if (file.isDirectory) {
                val subFolderId = createDriveFolder(drive, file.name ?: "folder", parentDriveFolderId)
                uploadDocumentFolder(drive, file, subFolderId, log)
            } else {
                val filename = file.name ?: "file"
                val mimeType = file.type ?: "application/octet-stream"
                log("  📄 업로드: $filename")

                val inputStream = context.contentResolver.openInputStream(file.uri) ?: return@forEach
                val mediaContent = InputStreamContent(mimeType, inputStream)

                val metadata = File().apply {
                    name = filename
                    parents = listOf(parentDriveFolderId)
                }

                drive.files().create(metadata, mediaContent)
                    .setFields("id")
                    .execute()
            }
        }
    }
}
