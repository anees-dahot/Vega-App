package com.vega

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

class ProviderHttpModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ProviderHttpModule"

    @ReactMethod
    fun fetch(url: String, options: ReadableMap, promise: Promise) {
        Thread {
            try {
                val method = if (options.hasKey("method")) options.getString("method")?.uppercase() ?: "GET" else "GET"
                val followRedirects = if (options.hasKey("redirect")) options.getString("redirect") != "manual" else true
                val timeoutMs = if (options.hasKey("timeoutMs")) options.getInt("timeoutMs").toLong() else 30_000L

                val client = OkHttpClientProvider.getOkHttpClient().newBuilder()
                    .followRedirects(followRedirects)
                    .followSslRedirects(followRedirects)
                    .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .build()

                val requestBuilder = Request.Builder().url(url)

                // Headers
                if (options.hasKey("headers")) {
                    val headersArray = options.getArray("headers")
                    if (headersArray != null) {
                        for (i in 0 until headersArray.size()) {
                            val pair = headersArray.getArray(i)
                            if (pair != null && pair.size() >= 2) {
                                val key = pair.getString(0) ?: ""
                                val value = pair.getString(1) ?: ""
                                if (key.isNotBlank()) {
                                    requestBuilder.addHeader(key, value)
                                }
                            }
                        }
                    }
                }

                // Body
                var requestBody: RequestBody? = null
                if (options.hasKey("bodyBase64")) {
                    val bodyBase64 = options.getString("bodyBase64")
                    val contentType = if (options.hasKey("contentType")) options.getString("contentType")?.toMediaTypeOrNull() else null
                    if (bodyBase64 != null) {
                        val bytes = Base64.decode(bodyBase64, Base64.DEFAULT)
                        requestBody = bytes.toRequestBody(contentType)
                    }
                } else if (options.hasKey("bodyText")) {
                    val bodyText = options.getString("bodyText")
                    val contentType = if (options.hasKey("contentType")) options.getString("contentType")?.toMediaTypeOrNull() else null
                    if (bodyText != null) {
                        requestBody = bodyText.toRequestBody(contentType)
                    }
                }

                if (method == "POST" || method == "PUT" || method == "PATCH" || method == "DELETE") {
                    requestBuilder.method(method, requestBody ?: "".toRequestBody(null))
                } else {
                    requestBuilder.method(method, null)
                }

                val response = client.newCall(requestBuilder.build()).execute()
                val responseHeaders = Arguments.createArray()
                for (name in response.headers.names()) {
                    for (value in response.headers.values(name)) {
                        val pair = Arguments.createArray()
                        pair.pushString(name)
                        pair.pushString(value)
                        responseHeaders.pushArray(pair)
                    }
                }

                val finalUrl = response.request.url.toString()
                val status = response.code
                val statusText = response.message

                val isRedirect = status in 300..399
                val maxBytes = 32 * 1024 * 1024 // 32MB

                val bodyBase64: String = if (followRedirects || !isRedirect) {
                    val responseBody = response.body
                    if (responseBody != null) {
                        val contentLength = responseBody.contentLength()
                        if (contentLength > maxBytes) {
                            response.close()
                            throw IOException("Provider response is too large")
                        }
                        val bytes = responseBody.bytes()
                        Base64.encodeToString(bytes, Base64.NO_WRAP)
                    } else {
                        ""
                    }
                } else {
                    response.close()
                    ""
                }

                val result = Arguments.createMap()
                result.putInt("status", status)
                result.putString("statusText", statusText)
                result.putString("url", finalUrl)
                result.putArray("headers", responseHeaders)
                result.putString("bodyBase64", bodyBase64)

                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("FETCH_ERROR", e.message ?: e.toString(), e)
            }
        }.start()
    }

    @ReactMethod
    fun downloadSegment(
        url: String,
        headers: ReadableMap?,
        outputPath: String,
        keyBase64: String?,
        ivHex: String?,
        promise: Promise,
    ) {
        runSegmentDownload(url, headers, outputPath, keyBase64, ivHex, promise)
    }
}

/**
 * Download one HLS segment straight to a file on a worker thread, decrypting
 * AES-128 on the way. OkHttp speaks HTTP/2 (some CDNs refuse HTTP/1.1), and
 * keeping the bytes out of JavaScript stops large downloads freezing the UI.
 */
private val segmentExecutor = Executors.newFixedThreadPool(6)

private fun ProviderHttpModule.runSegmentDownload(
    url: String,
    headers: ReadableMap?,
    outputPath: String,
    keyBase64: String?,
    ivHex: String?,
    promise: Promise,
) {
    segmentExecutor.execute {
        val target = File(outputPath.removePrefix("file://"))
        try {
            val client = OkHttpClientProvider.getOkHttpClient().newBuilder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .build()
            val builder = Request.Builder().url(url)
            headers?.toHashMap()?.forEach { (key, value) ->
                if (key.isNotBlank() && value is String) {
                    builder.header(key, value)
                }
            }
            client.newCall(builder.build()).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("Segment download failed with HTTP status ${response.code}")
                }
                val body = response.body ?: throw IOException("Segment response had no body")
                target.parentFile?.mkdirs()
                var input = body.byteStream()
                if (!keyBase64.isNullOrEmpty()) {
                    val key = Base64.decode(keyBase64, Base64.DEFAULT)
                    val iv = ByteArray(16)
                    val hex = (ivHex ?: "").removePrefix("0x").removePrefix("0X").padStart(32, '0').takeLast(32)
                    for (i in 0 until 16) {
                        iv[i] = hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
                    }
                    val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
                    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
                    input = CipherInputStream(input, cipher)
                }
                var written = 0L
                input.use { stream ->
                    FileOutputStream(target).use { out ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val read = stream.read(buffer)
                            if (read < 0) break
                            out.write(buffer, 0, read)
                            written += read
                        }
                    }
                }
                promise.resolve(written.toDouble())
            }
        } catch (e: Exception) {
            target.delete()
            promise.reject("SEGMENT_ERROR", e.message ?: e.toString(), e)
        }
    }
}

class ProviderHttpPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(ProviderHttpModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
