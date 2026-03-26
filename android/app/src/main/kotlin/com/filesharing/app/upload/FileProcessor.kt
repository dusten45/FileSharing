package com.filesharing.app.upload

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import com.filesharing.app.util.FileUtils
import com.filesharing.app.util.ZipUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 파일/폴더 업로드 핵심 라우팅 로직.
 * Python main.py의 process_file() / process_folder()를 포팅합니다.
 *
 * ZIP_COMPRESSION_RATIO = 0.85 (Python과 동일)
 */
class FileProcessor(
    private val context: Context,
    private val discordUploader: DiscordUploader,
    private val driveUploader: DriveUploader
) {

    companion object {
        private const val ZIP_COMPRESSION_RATIO = 0.85f
    }

    /**
     * 파일을 크기에 따라 Discord 또는 Google Drive에 업로드합니다.
     */
    suspend fun processFile(
        uri: Uri,
        webhookUrl: String,
        sizeLimitMb: Float,
        log: (String) -> Unit
    ) = withContext(Dispatchers.IO) {
        if (webhookUrl.isEmpty()) {
            log("❌ Discord Webhook URL이 설정되지 않았습니다. 설정 화면에서 입력해주세요.")
            return@withContext
        }

        val filename = FileUtils.getFilename(context, uri)
        val sizeMb = FileUtils.getFileSizeMb(context, uri)

        log("📄 $filename  (${"%.2f".format(sizeMb)} MB)")
        log("   기준 크기: $sizeLimitMb MB")

        var useDrive = sizeMb > sizeLimitMb

        if (!useDrive) {
            log("⬆️  Discord에 직접 업로드 중...")
            val success = discordUploader.uploadFile(uri, filename, webhookUrl)
            if (success) {
                log("✅ Discord 업로드 완료!")
                return@withContext
            } else {
                log("⚠️  Discord 직접 업로드 실패 → Google Drive로 전환...")
                useDrive = true
            }
        }

        if (useDrive) {
            try {
                val link = driveUploader.uploadFile(uri, filename, log)
                log("🔗 링크 생성됨: $link")
                log("💬 Discord에 링크 전송 중...")
                discordUploader.sendLink(link, filename, sizeMb, false, webhookUrl)
                log("✅ 완료! Google Drive 링크가 Discord에 전송됐어요.")
            } catch (e: Exception) {
                log("❌ 오류 발생: ${e.message}")
            }
        }
    }

    /**
     * 폴더를 크기에 따라 zip 후 Discord 업로드하거나 Google Drive에 폴더 업로드합니다.
     */
    suspend fun processFolder(
        treeUri: Uri,
        webhookUrl: String,
        sizeLimitMb: Float,
        log: (String) -> Unit
    ) = withContext(Dispatchers.IO) {
        if (webhookUrl.isEmpty()) {
            log("❌ Discord Webhook URL이 설정되지 않았습니다. 설정 화면에서 입력해주세요.")
            return@withContext
        }

        val folderName = FileUtils.getFolderName(context, treeUri)
        val rootDocFile = DocumentFile.fromTreeUri(context, treeUri)
            ?: run { log("❌ 폴더를 열 수 없습니다."); return@withContext }

        val rawMb = FileUtils.getFolderRawSizeMb(rootDocFile)
        log("📁 $folderName/  (원본 ${"%.2f".format(rawMb)} MB)")
        log("   기준 크기: $sizeLimitMb MB")

        // 보수적 압축률(0.85)로 추정해도 기준 초과 → zip 생략하고 Drive 폴더 업로드
        val estimatedMb = rawMb * ZIP_COMPRESSION_RATIO
        if (estimatedMb > sizeLimitMb) {
            log("   추정 압축 크기 ${"%.1f".format(estimatedMb)} MB > $sizeLimitMb MB → zip 생략, Drive 폴더 업로드")
            try {
                val link = driveUploader.uploadFolder(treeUri, folderName, log)
                log("🔗 폴더 링크 생성됨: $link")
                log("💬 Discord에 링크 전송 중...")
                discordUploader.sendLink(link, folderName, rawMb, true, webhookUrl)
                log("✅ 완료! Google Drive 폴더 링크가 Discord에 전송됐어요.")
            } catch (e: Exception) {
                log("❌ 오류 발생: ${e.message}")
            }
            return@withContext
        }

        // zip 시도
        log("   추정 압축 크기 ${"%.1f".format(estimatedMb)} MB ≤ $sizeLimitMb MB → zip 압축 시도...")
        var zipFile: java.io.File? = null
        try {
            zipFile = ZipUtils.zipDocumentFolder(context, treeUri, folderName)
            val zipMb = zipFile.length() / (1024f * 1024f)
            log("   압축 완료: ${"%.2f".format(zipMb)} MB")

            if (zipMb <= sizeLimitMb) {
                log("⬆️  Discord에 직접 업로드 중...")
                val zipUri = Uri.fromFile(zipFile)
                val success = discordUploader.uploadFile(zipUri, zipFile.name, webhookUrl)
                if (success) {
                    log("✅ Discord 업로드 완료!")
                    return@withContext
                }
                log("⚠️  Discord 직접 업로드 실패 → Google Drive로 전환...")
            } else {
                log("   실제 압축 크기 ${"%.2f".format(zipMb)} MB > $sizeLimitMb MB → Drive 폴더 업로드")
            }

            // fallback: Drive 폴더 업로드
            val link = driveUploader.uploadFolder(treeUri, folderName, log)
            log("🔗 폴더 링크 생성됨: $link")
            log("💬 Discord에 링크 전송 중...")
            discordUploader.sendLink(link, folderName, rawMb, true, webhookUrl)
            log("✅ 완료! Google Drive 폴더 링크가 Discord에 전송됐어요.")

        } catch (e: Exception) {
            log("❌ 오류 발생: ${e.message}")
        } finally {
            zipFile?.delete()
        }
    }
}
