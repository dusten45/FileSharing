package com.filesharing.app.util

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.documentfile.provider.DocumentFile

object FileUtils {

    /** SAF URI에서 파일명을 반환합니다. */
    fun getFilename(context: Context, uri: Uri): String {
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (cursor.moveToFirst() && nameIndex >= 0) {
                return cursor.getString(nameIndex) ?: uri.lastPathSegment ?: "unknown"
            }
        }
        return uri.lastPathSegment ?: "unknown"
    }

    /** SAF URI에서 파일 크기(MB)를 반환합니다. */
    fun getFileSizeMb(context: Context, uri: Uri): Float {
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (cursor.moveToFirst() && sizeIndex >= 0) {
                val bytes = cursor.getLong(sizeIndex)
                return bytes / (1024f * 1024f)
            }
        }
        // 스트림 열어서 직접 계산 (fallback)
        return try {
            context.contentResolver.openInputStream(uri)?.use { it.available() / (1024f * 1024f) } ?: 0f
        } catch (e: Exception) {
            0f
        }
    }

    /** DocumentFile 폴더의 전체 크기(MB)를 재귀적으로 계산합니다. */
    fun getFolderRawSizeMb(folder: DocumentFile): Float {
        var totalBytes = 0L
        folder.listFiles().forEach { file ->
            totalBytes += if (file.isDirectory) {
                (getFolderRawSizeMb(file) * 1024 * 1024).toLong()
            } else {
                file.length()
            }
        }
        return totalBytes / (1024f * 1024f)
    }

    /** tree URI에서 폴더명을 반환합니다. */
    fun getFolderName(context: Context, treeUri: Uri): String {
        val docFile = DocumentFile.fromTreeUri(context, treeUri)
        return docFile?.name ?: treeUri.lastPathSegment ?: "folder"
    }
}
