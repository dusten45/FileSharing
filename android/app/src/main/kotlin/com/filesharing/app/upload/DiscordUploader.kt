package com.filesharing.app.upload

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class DiscordUploader(private val context: Context) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(300, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /**
     * 파일을 Discord Webhook으로 직접 업로드합니다.
     * @return 성공 여부
     */
    suspend fun uploadFile(uri: Uri, filename: String, webhookUrl: String): Boolean =
        withContext(Dispatchers.IO) {
            try {
                val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
                val inputStream = context.contentResolver.openInputStream(uri)
                    ?: return@withContext false
                val bytes = inputStream.use { it.readBytes() }
                val requestBody = bytes.toRequestBody(mimeType.toMediaTypeOrNull())

                val multipart = MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart("file", filename, requestBody)
                    .build()

                val request = Request.Builder()
                    .url(webhookUrl)
                    .post(multipart)
                    .build()

                val response = client.newCall(request).execute()
                response.code in 200..204
            } catch (e: IOException) {
                false
            }
        }

    /**
     * Google Drive 링크를 Discord에 전송합니다.
     * @return 성공 여부
     */
    suspend fun sendLink(
        link: String,
        filename: String,
        sizeMb: Float,
        isFolder: Boolean,
        webhookUrl: String
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val type = if (isFolder) "📁 폴더" else "📄 파일"
            val content = """
                **$type 업로드 완료**
                파일명: `$filename`
                크기: ${"%.2f".format(sizeMb)} MB
                링크: $link
            """.trimIndent()

            val json = """{"content":"${content.replace("\"", "\\\"")}"}"""
            val body = json.toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url(webhookUrl)
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            response.code in 200..204
        } catch (e: IOException) {
            false
        }
    }
}
