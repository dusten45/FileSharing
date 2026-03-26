package com.filesharing.app.util

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

object ZipUtils {

    /**
     * SAF tree URI의 폴더를 DEFLATE 압축으로 cacheDir의 임시 zip 파일로 만듭니다.
     * Python의 zip_folder()에 대응합니다.
     *
     * @return 생성된 zip 파일 (사용 후 반드시 삭제해야 합니다)
     */
    suspend fun zipDocumentFolder(context: Context, treeUri: Uri, folderName: String): File =
        withContext(Dispatchers.IO) {
            val zipFile = File(context.cacheDir, "$folderName.zip")
            if (zipFile.exists()) zipFile.delete()

            val rootDocFile = DocumentFile.fromTreeUri(context, treeUri)
                ?: error("폴더를 열 수 없습니다.")

            ZipOutputStream(zipFile.outputStream().buffered()).use { zos ->
                zos.setLevel(Deflater.DEFAULT_COMPRESSION)
                addDocumentToZip(context, zos, rootDocFile, "")
            }

            zipFile
        }

    private fun addDocumentToZip(
        context: Context,
        zos: ZipOutputStream,
        docFile: DocumentFile,
        parentPath: String
    ) {
        val name = docFile.name ?: return
        val entryPath = if (parentPath.isEmpty()) name else "$parentPath/$name"

        if (docFile.isDirectory) {
            // 디렉토리 엔트리 추가
            zos.putNextEntry(ZipEntry("$entryPath/"))
            zos.closeEntry()
            docFile.listFiles().forEach { child ->
                addDocumentToZip(context, zos, child, entryPath)
            }
        } else {
            val entry = ZipEntry(entryPath)
            zos.putNextEntry(entry)
            context.contentResolver.openInputStream(docFile.uri)?.use { input ->
                input.copyTo(zos)
            }
            zos.closeEntry()
        }
    }
}
