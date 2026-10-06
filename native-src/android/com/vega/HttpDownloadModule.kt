package com.vega

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.provider.DocumentsContract
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.ReturnCode
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import java.io.EOFException
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicLongArray
import kotlin.math.min

private class DownloadCancelledException : IOException("Download cancelled")

private data class HttpDownloadJob(
    val id: String,
    val url: String,
    val destinationUri: Uri,
    val headers: Map<String, String>,
    val completion: Promise,
) {
    @Volatile var cancelled = false
    @Volatile var userPaused = false
    @Volatile var call: Call? = null
    @Volatile var cancelPromise: Promise? = null
    @Volatile var deleteOnCancel = false
    /** Set when a server refuses parallel range requests; this job then uses one connection. */
    @Volatile var segmentedDisabled = false
    /** Calls of the parallel parts of a segmented download. */
    val calls: MutableSet<Call> = ConcurrentHashMap.newKeySet()
    val monitor = Object()

    fun cancelCalls() {
        call?.cancel()
        calls.forEach { it.cancel() }
    }
}

/**
 * Streams HTTP response bodies directly into an SAF document. The document is
 * intentionally kept when the network disappears or the process is stopped;
 * the next start reads its current size and resumes with a validated Range.
 */
class HttpDownloadModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val PROGRESS_EVENT = "VegaHttpDownloadProgress"
        private const val STATE_EVENT = "VegaHttpDownloadState"
        private const val PROGRESS_INTERVAL_MS = 500L
        private const val INITIAL_RETRY_DELAY_MS = 1_000L
        private const val MAX_RETRY_DELAY_MS = 30_000L
        private const val BUFFER_SIZE = 512 * 1024

        /** Files smaller than this download on one connection: splitting does not pay off. */
        private const val SEGMENT_MIN_FILE_BYTES = 8L * 1024 * 1024
        private const val SEGMENT_BUFFER_SIZE = 256 * 1024
        private const val SEGMENT_PERSIST_INTERVAL_MS = 2_000L
        private const val MAX_CONNECTIONS = 16

        private val jobs = ConcurrentHashMap<String, HttpDownloadJob>()
        private val executor = Executors.newCachedThreadPool()

        /** Only use unmetered connections. Set from the app's download settings. */
        @Volatile private var wifiOnly = false

        /** Parallel connections used for one file when the server allows ranges. */
        @Volatile private var connectionsPerFile = 8
    }

    private val metadata by lazy {
        reactContext.getSharedPreferences("vega_http_downloads", Context.MODE_PRIVATE)
    }

    private val connectivityManager by lazy {
        reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            wakeJobsWhenNetworkReturns()
        }

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities,
        ) {
            if (hasUsableInternet(networkCapabilities)) {
                wakeJobsWhenNetworkReturns()
            } else {
                pauseJobsForNetworkLoss()
            }
        }

        override fun onLost(network: Network) {
            pauseJobsForNetworkLoss()
        }
    }

    init {
        runCatching { connectivityManager.registerDefaultNetworkCallback(networkCallback) }
    }

    private val client by lazy {
        OkHttpClientProvider.getOkHttpClient()
            .newBuilder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    /**
     * For the parts of one file. HTTP/2 would carry every part over a single TCP
     * connection, so a server that limits each connection would limit all of them
     * together. HTTP/1.1 gives every part its own connection.
     */
    private val segmentedClient by lazy {
        client.newBuilder()
            .protocols(listOf(Protocol.HTTP_1_1))
            .connectionPool(ConnectionPool(MAX_CONNECTIONS * 2, 2, TimeUnit.MINUTES))
            .build()
    }

    override fun getName(): String = "HttpDownloadModule"

    override fun invalidate() {
        runCatching { connectivityManager.unregisterNetworkCallback(networkCallback) }
        super.invalidate()
    }

    @ReactMethod
    fun start(
        downloadId: String,
        url: String,
        destinationUri: String,
        headers: ReadableMap?,
        promise: Promise,
    ) {
        if (jobs.containsKey(downloadId)) {
            promise.reject("DOWNLOAD_ACTIVE", "Download is already active")
            return
        }

        val job = HttpDownloadJob(
            id = downloadId,
            url = url,
            destinationUri = Uri.parse(destinationUri),
            headers = readableHeaders(headers),
            completion = promise,
        )
        jobs[downloadId] = job
        executor.execute { runJob(job) }
    }

    @ReactMethod
    fun pause(downloadId: String, promise: Promise) {
        val job = jobs[downloadId]
        if (job == null || job.cancelled) {
            promise.reject("DOWNLOAD_NOT_ACTIVE", "Download is not active")
            return
        }
        job.userPaused = true
        job.cancelCalls()
        emitState(job.id, "paused")
        promise.resolve(null)
    }

    @ReactMethod
    fun resume(downloadId: String, promise: Promise) {
        val job = jobs[downloadId]
        if (job == null || job.cancelled) {
            promise.reject("DOWNLOAD_NOT_ACTIVE", "Download is not active")
            return
        }
        synchronized(job.monitor) {
            job.userPaused = false
            job.monitor.notifyAll()
        }
        if (hasNetwork()) {
            emitState(job.id, "connecting")
        } else {
            emitState(job.id, "waitingForNetwork", "Waiting for network connection")
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun cancel(downloadId: String, deleteDestination: Boolean, promise: Promise) {
        val job = jobs[downloadId]
        if (job != null) {
            job.cancelPromise = promise
            job.deleteOnCancel = deleteDestination
            job.cancelled = true
            job.cancelCalls()
            synchronized(job.monitor) {
                job.userPaused = false
                job.monitor.notifyAll()
            }
        } else {
            promise.resolve(null)
        }
    }

    /**
     * Wi-Fi only stops downloads on a metered connection (they wait, like with no
     * network, and continue on their own). Connections is how many parts of one
     * file download at the same time.
     */
    @ReactMethod
    fun setPolicy(wifiOnlyEnabled: Boolean, connections: Double) {
        wifiOnly = wifiOnlyEnabled
        connectionsPerFile = connections.toInt().coerceIn(1, MAX_CONNECTIONS)
        if (hasNetwork()) {
            wakeJobsWhenNetworkReturns()
        } else {
            pauseJobsForNetworkLoss()
        }
    }

    /** Length of a media file in seconds, or 0 when it cannot be read. */
    @ReactMethod
    fun probeDuration(path: String, promise: Promise) {
        executor.execute {
            try {
                val duration = FFprobeKit.getMediaInformation(path).mediaInformation?.duration
                promise.resolve(duration?.toDoubleOrNull() ?: 0.0)
            } catch (error: Exception) {
                promise.resolve(0.0)
            }
        }
    }

    /**
     * Adds the first audio track of [audioPath] to [videoPath] as one more track,
     * writing a new Matroska file at [outputPath]. Nothing is re-encoded. A shift
     * of [offsetSeconds] moves the new audio against the video.
     */
    @ReactMethod
    fun mergeAudioTrack(
        videoPath: String,
        audioPath: String,
        language: String,
        title: String,
        offsetSeconds: Double,
        outputPath: String,
        promise: Promise
    ) {
        executor.execute {
            try {
                val info = FFprobeKit.getMediaInformation(videoPath).mediaInformation
                val existing = info?.streams?.count { it.type == "audio" } ?: 0
                fun run(convertSubtitles: Boolean): Pair<Boolean, String> {
                    val args = mutableListOf("-y", "-i", videoPath)
                    if (offsetSeconds != 0.0) {
                        args += listOf("-itsoffset", offsetSeconds.toString())
                    }
                    args += listOf(
                        "-i", audioPath,
                        "-map", "0:v", "-map", "0:a", "-map", "0:s?", "-map", "0:t?", "-map", "1:a:0",
                        "-c", "copy"
                    )
                    if (convertSubtitles) {
                        args += listOf("-c:s", "srt")
                    }
                    args += listOf(
                        "-metadata:s:a:$existing", "language=$language",
                        "-metadata:s:a:$existing", "title=$title",
                        "-disposition:a:$existing", "0",
                        "-f", "matroska", outputPath
                    )
                    val session = FFmpegKit.executeWithArguments(args.toTypedArray())
                    return Pair(
                        ReturnCode.isSuccess(session.returnCode),
                        session.allLogsAsString.takeLast(400)
                    )
                }
                var result = run(false)
                if (!result.first) {
                    // mov_text subtitles from an MP4 can't be copied into Matroska.
                    result = run(true)
                }
                if (result.first) {
                    promise.resolve(outputPath)
                } else {
                    promise.reject("MERGE_FAILED", result.second)
                }
            } catch (error: Exception) {
                promise.reject("MERGE_FAILED", error.message, error)
            }
        }
    }

    /** Opens the system share sheet for a file, giving the chosen app read access to it. */
    @ReactMethod
    fun shareFile(uriString: String, mimeType: String, title: String?, promise: Promise) {
        try {
            val activity = reactContext.currentActivity
                ?: throw IllegalStateException("The app is not in the foreground")
            val uri = Uri.parse(uriString)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = if (mimeType.isBlank()) "video/*" else mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newRawUri(title ?: "Video", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, title ?: "Share").apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(chooser)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("SHARE_FAILED", error.message, error)
        }
    }

    /** Shows a folder (a picked storage tree) in the system file app. */
    @ReactMethod
    fun openFolder(treeUriString: String, promise: Promise) {
        try {
            val activity = reactContext.currentActivity
                ?: throw IllegalStateException("The app is not in the foreground")
            val treeUri = Uri.parse(treeUriString)
            val folderUri = DocumentsContract.buildDocumentUriUsingTree(
                treeUri,
                DocumentsContract.getTreeDocumentId(treeUri),
            )
            val view = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(folderUri, DocumentsContract.Document.MIME_TYPE_DIR)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(view)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("OPEN_FOLDER_FAILED", error.message, error)
        }
    }

    @ReactMethod
    fun isUnmetered(promise: Promise) {
        val network = connectivityManager.activeNetwork
        val capabilities = network?.let { connectivityManager.getNetworkCapabilities(it) }
        promise.resolve(
            capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
        )
    }

    @ReactMethod
    fun getUriSize(uriString: String, promise: Promise) {
        try {
            reactContext.contentResolver.openFileDescriptor(Uri.parse(uriString), "r")?.use { pfd ->
                FileInputStream(pfd.fileDescriptor).channel.use { channel ->
                    promise.resolve(channel.size().toDouble())
                }
            } ?: throw IOException("Unable to open SAF document")
        } catch (error: Exception) {
            promise.reject("SAF_SIZE_FAILED", error.message, error)
        }
    }

    // Required by NativeEventEmitter.
    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit

    private fun runJob(job: HttpDownloadJob) {
        var retryDelay = INITIAL_RETRY_DELAY_MS
        try {
            while (!job.cancelled) {
                waitWhilePaused(job)
                if (job.cancelled) throw DownloadCancelledException()

                if (!hasNetwork()) {
                    emitState(job.id, "waitingForNetwork", "Waiting for network connection")
                    waitForRetry(job, 0L)
                    continue
                }

                try {
                    emitState(job.id, "connecting")
                    val result = transfer(job)
                    clearMetadata(job.id)
                    emitProgress(job.id, result.first, result.second, 0.0)
                    emitState(job.id, "completed")
                    job.completion.resolve(Arguments.createMap().apply {
                        putDouble("downloadedBytes", result.first.toDouble())
                        putDouble("totalBytes", result.second.toDouble())
                        putString("destinationUri", job.destinationUri.toString())
                    })
                    return
                } catch (error: Exception) {
                    if (job.cancelled) throw DownloadCancelledException()
                    if (job.userPaused) continue
                    if (error is SegmentedUnsupportedException) {
                        // The server does not allow parallel parts; start over on one connection.
                        job.segmentedDisabled = true
                        continue
                    }
                    if (!isRetryable(error)) throw error

                    emitState(job.id, "waitingForNetwork", error.message)
                    waitForRetry(job, retryDelay)
                    retryDelay = min(retryDelay * 2, MAX_RETRY_DELAY_MS)
                } finally {
                    job.call = null
                }
            }
            throw DownloadCancelledException()
        } catch (error: DownloadCancelledException) {
            emitState(job.id, "cancelled")
            job.completion.reject("DOWNLOAD_CANCELLED", error.message, error)
        } catch (error: Exception) {
            emitState(job.id, "failed", error.message)
            job.completion.reject("DOWNLOAD_FAILED", error.message, error)
        } finally {
            jobs.remove(job.id, job)
            if (job.cancelled && job.deleteOnCancel) {
                runCatching {
                    reactContext.contentResolver.delete(job.destinationUri, null, null)
                }
                clearMetadata(job.id)
            }
            job.cancelPromise?.resolve(null)
        }
    }

    private fun transfer(job: HttpDownloadJob): Pair<Long, Long> {
        if (!job.segmentedDisabled && connectionsPerFile > 1) {
            transferSegmented(job)?.let { return it }
        }
        val resolver = reactContext.contentResolver
        val openedDescriptor = try {
            resolver.openFileDescriptor(job.destinationUri, "rw")
        } catch (error: Exception) {
            throw DestinationException("Unable to open the SAF destination", error)
        }
        openedDescriptor?.use { descriptor ->
            FileOutputStream(descriptor.fileDescriptor).use { output ->
                val channel = output.channel
                var existingBytes = try {
                    channel.size().coerceAtLeast(0L)
                } catch (error: Exception) {
                    throw DestinationException("SAF destination does not support seeking", error)
                }
                val requestBuilder = Request.Builder().url(job.url)
                var hasAcceptEncoding = false
                job.headers.forEach { (name, value) ->
                    if (name.equals("accept-encoding", ignoreCase = true)) {
                        hasAcceptEncoding = true
                    }
                    if (!name.equals("range", ignoreCase = true) &&
                        !name.equals("if-range", ignoreCase = true)) {
                        requestBuilder.header(name, value)
                    }
                }
                if (!hasAcceptEncoding) {
                    requestBuilder.header("Accept-Encoding", "identity")
                }

                val storedUrl = metadata.getString(metaKey(job.id, "url"), null)
                val storedUri = metadata.getString(metaKey(job.id, "uri"), null)
                val canUseValidator = storedUrl == job.url && storedUri == job.destinationUri.toString()
                if (existingBytes > 0L) {
                    requestBuilder.header("Range", "bytes=$existingBytes-")
                    if (canUseValidator) {
                        val validator = metadata.getString(metaKey(job.id, "etag"), null)
                            ?: metadata.getString(metaKey(job.id, "lastModified"), null)
                        validator?.let { requestBuilder.header("If-Range", it) }
                    }
                }

                val call = client.newCall(requestBuilder.build())
                job.call = call
                val response = call.execute()
                response.use {
                    if (response.code == 416) {
                        val expectedTotal = parseUnsatisfiedTotal(response.header("Content-Range"))
                        if (expectedTotal >= 0L && existingBytes == expectedTotal) {
                            return existingBytes to expectedTotal
                        }
                        try {
                            channel.truncate(0L)
                        } catch (error: Exception) {
                            throw DestinationException("Unable to reset the SAF destination", error)
                        }
                        clearMetadata(job.id)
                        throw IOException("Server rejected the saved byte range; restarting")
                    }
                    if (!response.isSuccessful) {
                        throw HttpStatusException(response.code)
                    }

                    var writeOffset = existingBytes
                    if (existingBytes > 0L && response.code == 206) {
                        val rangeStart = parseContentRangeStart(response.header("Content-Range"))
                        if (rangeStart != existingBytes) {
                            try {
                                channel.truncate(0L)
                            } catch (error: Exception) {
                                throw DestinationException("Unable to reset the SAF destination", error)
                            }
                            clearMetadata(job.id)
                            throw IOException("Server returned an invalid byte range; restarting")
                        }
                    } else if (existingBytes > 0L) {
                        // The server ignored Range or the validator changed. Never append a full
                        // response to a partial file because that silently corrupts the video.
                        try {
                            channel.truncate(0L)
                        } catch (error: Exception) {
                            throw DestinationException("Unable to reset the SAF destination", error)
                        }
                        writeOffset = 0L
                        existingBytes = 0L
                    }

                    val body = response.body ?: throw IOException("Empty response body")
                    val totalBytes = parseContentRangeTotal(response.header("Content-Range"))
                        .takeIf { it > 0L }
                        ?: body.contentLength().takeIf { it >= 0L }?.plus(writeOffset)
                        ?: 0L

                    saveMetadata(job, response)
                    try {
                        channel.position(writeOffset)
                    } catch (error: Exception) {
                        throw DestinationException("SAF destination does not support resuming", error)
                    }
                    var downloadedBytes = writeOffset
                    var previousBytes = downloadedBytes
                    var previousTime = System.currentTimeMillis()
                    val buffer = ByteArray(BUFFER_SIZE)
                    body.byteStream().use { input ->
                        while (true) {
                            if (job.cancelled) throw DownloadCancelledException()
                            if (job.userPaused) throw IOException("Download paused")
                            val read = input.read(buffer)
                            if (read < 0) break
                            val byteBuffer = java.nio.ByteBuffer.wrap(buffer, 0, read)
                            try {
                                while (byteBuffer.hasRemaining()) {
                                    channel.write(byteBuffer)
                                }
                            } catch (error: Exception) {
                                throw DestinationException("Unable to write to the SAF destination", error)
                            }
                            downloadedBytes += read

                            val now = System.currentTimeMillis()
                            val elapsed = now - previousTime
                            if (elapsed >= PROGRESS_INTERVAL_MS) {
                                val speed = ((downloadedBytes - previousBytes) * 1000.0) / elapsed
                                emitProgress(job.id, downloadedBytes, totalBytes, speed)
                                previousBytes = downloadedBytes
                                previousTime = now
                            }
                        }
                    }
                    try {
                        output.flush()
                        descriptor.fileDescriptor.sync()
                    } catch (error: Exception) {
                        throw DestinationException("Unable to flush the SAF destination", error)
                    }
                    if (totalBytes > 0L && downloadedBytes < totalBytes) {
                        throw EOFException("Connection ended before the file was complete")
                    }
                    return downloadedBytes to if (totalBytes > 0L) totalBytes else downloadedBytes
                }
            }
        }
        throw IOException("Unable to open the SAF destination")
    }

    private fun requestFor(job: HttpDownloadJob, range: String?, validator: String?): Request {
        val builder = Request.Builder().url(job.url)
        var hasAcceptEncoding = false
        job.headers.forEach { (name, value) ->
            if (name.equals("accept-encoding", ignoreCase = true)) {
                hasAcceptEncoding = true
            }
            if (!name.equals("range", ignoreCase = true) &&
                !name.equals("if-range", ignoreCase = true)) {
                builder.header(name, value)
            }
        }
        if (!hasAcceptEncoding) {
            builder.header("Accept-Encoding", "identity")
        }
        range?.let { builder.header("Range", it) }
        validator?.let { builder.header("If-Range", it) }
        return builder.build()
    }

    /**
     * Downloads one file as several parts at the same time. Returns null when
     * this file should use the normal single connection instead: the server
     * does not answer range requests, the file is small, or a partial file from
     * a single-connection attempt is already there (it can only continue that way).
     *
     * Progress of every part is saved, so a stop or a lost connection continues
     * where each part stopped. A failure in one part stops all of them and the
     * normal retry loop starts them again.
     */
    private fun transferSegmented(job: HttpDownloadJob): Pair<Long, Long>? {
        val connections = connectionsPerFile
        var total = -1L
        var etag: String? = null
        var lastModified: String? = null
        val probeCall = segmentedClient.newCall(requestFor(job, "bytes=0-0", null))
        job.calls.add(probeCall)
        try {
            probeCall.execute().use { response ->
                if (response.code != 206) return null
                total = parseContentRangeTotal(response.header("Content-Range"))
                etag = response.header("ETag")
                lastModified = response.header("Last-Modified")
            }
        } finally {
            job.calls.remove(probeCall)
        }
        if (total < SEGMENT_MIN_FILE_BYTES) return null
        val validator = etag ?: lastModified

        val storedTotal = metadata.getLong(metaKey(job.id, "segTotal"), -1L)
        val storedCount = metadata.getInt(metaKey(job.id, "segCount"), -1)
        val storedValidator = metadata.getString(metaKey(job.id, "segValidator"), null)
        val resumable = storedTotal == total &&
            storedCount == connections &&
            (storedValidator == null || validator == null || storedValidator == validator)

        val openedDescriptor = try {
            reactContext.contentResolver.openFileDescriptor(job.destinationUri, "rw")
        } catch (error: Exception) {
            throw DestinationException("Unable to open the SAF destination", error)
        } ?: return null
        return openedDescriptor.use { descriptor ->
            FileOutputStream(descriptor.fileDescriptor).use { output ->
                val channel = output.channel
                val existing = try {
                    channel.size().coerceAtLeast(0L)
                } catch (error: Exception) {
                    throw DestinationException("SAF destination does not support seeking", error)
                }
                // Data from a single-connection attempt is one block from the start.
                if (!resumable && existing > 0L) return null

                val segmentSize = (total + connections - 1) / connections
                val starts = LongArray(connections) { it * segmentSize }
                val ends = LongArray(connections) { min(total, (it + 1) * segmentSize) - 1 }
                val done = AtomicLongArray(connections)
                if (resumable) {
                    for (index in 0 until connections) {
                        val saved = metadata.getLong(metaKey(job.id, "seg$index"), 0L)
                        done.set(index, saved.coerceIn(0L, ends[index] - starts[index] + 1))
                    }
                } else {
                    metadata.edit()
                        .putString(metaKey(job.id, "url"), job.url)
                        .putString(metaKey(job.id, "uri"), job.destinationUri.toString())
                        .putLong(metaKey(job.id, "segTotal"), total)
                        .putInt(metaKey(job.id, "segCount"), connections)
                        .apply {
                            validator?.let { putString(metaKey(job.id, "segValidator"), it) }
                            for (index in 0 until connections) {
                                putLong(metaKey(job.id, "seg$index"), 0L)
                            }
                        }
                        .commit()
                }

                val downloaded = AtomicLong(0L)
                for (index in 0 until connections) {
                    downloaded.addAndGet(done.get(index))
                }
                val errors = ConcurrentLinkedQueue<Throwable>()
                val abort = AtomicBoolean(false)
                val finished = CountDownLatch(connections)
                for (index in 0 until connections) {
                    executor.execute {
                        try {
                            downloadSegment(
                                job, channel, index, starts[index], ends[index],
                                done, downloaded, validator, abort,
                            )
                        } catch (error: Throwable) {
                            errors.add(error)
                            abort.set(true)
                            job.cancelCalls()
                        } finally {
                            finished.countDown()
                        }
                    }
                }

                val persist = {
                    val editor = metadata.edit()
                    for (index in 0 until connections) {
                        editor.putLong(metaKey(job.id, "seg$index"), done.get(index))
                    }
                    editor.apply()
                }
                var previousBytes = downloaded.get()
                var previousTime = System.currentTimeMillis()
                var lastPersist = previousTime
                while (!finished.await(250, TimeUnit.MILLISECONDS)) {
                    val now = System.currentTimeMillis()
                    val elapsed = now - previousTime
                    if (elapsed >= PROGRESS_INTERVAL_MS) {
                        val current = downloaded.get()
                        emitProgress(job.id, current, total, ((current - previousBytes) * 1000.0) / elapsed)
                        previousBytes = current
                        previousTime = now
                    }
                    if (now - lastPersist >= SEGMENT_PERSIST_INTERVAL_MS) {
                        persist()
                        lastPersist = now
                    }
                }
                persist()

                val failure = errors.peek()
                if (failure != null) {
                    if (failure is SegmentedUnsupportedException) {
                        // Whatever was written is scattered; the single-connection path needs a clean file.
                        try {
                            channel.truncate(0L)
                        } catch (error: Exception) {
                            throw DestinationException("Unable to reset the SAF destination", error)
                        }
                        clearMetadata(job.id)
                    }
                    throw (failure as? Exception) ?: IOException(failure)
                }
                if (downloaded.get() < total) {
                    throw EOFException("Connection ended before the file was complete")
                }
                try {
                    output.flush()
                    descriptor.fileDescriptor.sync()
                } catch (error: Exception) {
                    throw DestinationException("Unable to flush the SAF destination", error)
                }
                total to total
            }
        }
    }

    private fun downloadSegment(
        job: HttpDownloadJob,
        channel: FileChannel,
        index: Int,
        start: Long,
        end: Long,
        done: AtomicLongArray,
        downloaded: AtomicLong,
        validator: String?,
        abort: AtomicBoolean,
    ) {
        val offset = start + done.get(index)
        if (offset > end) return
        val call = segmentedClient.newCall(requestFor(job, "bytes=$offset-$end", validator))
        job.calls.add(call)
        try {
            call.execute().use { response ->
                if (response.code != 206) {
                    // A server that answers 200, or limits parallel use, gets one connection.
                    if (response.code == 200 || response.code == 416 ||
                        response.code == 429 || response.code == 503) {
                        throw SegmentedUnsupportedException("HTTP ${response.code} for a part")
                    }
                    throw HttpStatusException(response.code)
                }
                val body = response.body ?: throw IOException("Empty response body")
                var position = offset
                val buffer = ByteArray(SEGMENT_BUFFER_SIZE)
                body.byteStream().use { input ->
                    while (position <= end) {
                        if (job.cancelled) throw DownloadCancelledException()
                        if (job.userPaused) throw IOException("Download paused")
                        if (abort.get()) throw IOException("Download stopped")
                        val wanted = min(buffer.size.toLong(), end - position + 1).toInt()
                        val read = input.read(buffer, 0, wanted)
                        if (read < 0) break
                        val bytes = ByteBuffer.wrap(buffer, 0, read)
                        var writeAt = position
                        try {
                            while (bytes.hasRemaining()) {
                                writeAt += channel.write(bytes, writeAt)
                            }
                        } catch (error: Exception) {
                            throw DestinationException("Unable to write to the SAF destination", error)
                        }
                        position += read
                        done.addAndGet(index, read.toLong())
                        downloaded.addAndGet(read.toLong())
                    }
                }
                if (position <= end) {
                    throw EOFException("Connection ended before the part was complete")
                }
            }
        } finally {
            job.calls.remove(call)
        }
    }

    private fun waitWhilePaused(job: HttpDownloadJob) {
        synchronized(job.monitor) {
            while (job.userPaused && !job.cancelled) {
                job.monitor.wait()
            }
        }
    }

    private fun waitForRetry(job: HttpDownloadJob, delayMs: Long) {
        var waited = 0L
        while (!job.cancelled && !job.userPaused) {
            if (hasNetwork() && waited >= delayMs) return
            synchronized(job.monitor) { job.monitor.wait(1_000L) }
            waited += 1_000L
        }
    }

    private fun pauseJobsForNetworkLoss() {
        if (hasNetwork()) return
        jobs.values.forEach { job ->
            if (!job.cancelled && !job.userPaused) {
                emitState(job.id, "waitingForNetwork", "Waiting for network connection")
                // Interrupt a blocked OkHttp read immediately instead of waiting for its timeout.
                job.cancelCalls()
                synchronized(job.monitor) { job.monitor.notifyAll() }
            }
        }
    }

    private fun wakeJobsWhenNetworkReturns() {
        if (!hasNetwork()) return
        jobs.values.forEach { job ->
            if (!job.cancelled && !job.userPaused) {
                synchronized(job.monitor) { job.monitor.notifyAll() }
            }
        }
    }

    private fun hasUsableInternet(capabilities: NetworkCapabilities): Boolean =
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) &&
            (!wifiOnly || capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))

    private fun hasNetwork(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return hasUsableInternet(capabilities)
    }

    private fun isRetryable(error: Exception): Boolean = when (error) {
        is DownloadCancelledException -> false
        is DestinationException -> false
        is HttpStatusException -> error.status == 408 || error.status == 429 || error.status >= 500
        is IOException -> true
        else -> false
    }

    private fun saveMetadata(job: HttpDownloadJob, response: Response) {
        metadata.edit()
            .putString(metaKey(job.id, "url"), job.url)
            .putString(metaKey(job.id, "uri"), job.destinationUri.toString())
            .apply {
                response.header("ETag")?.let { putString(metaKey(job.id, "etag"), it) }
                response.header("Last-Modified")?.let {
                    putString(metaKey(job.id, "lastModified"), it)
                }
            }
            .apply()
    }

    private fun clearMetadata(downloadId: String) {
        val editor = metadata.edit()
        val prefix = "$downloadId:"
        metadata.all.keys.filter { it.startsWith(prefix) }.forEach { editor.remove(it) }
        editor.apply()
    }

    private fun metaKey(downloadId: String, field: String) = "$downloadId:$field"

    private fun emitProgress(downloadId: String, downloaded: Long, total: Long, speed: Double) {
        emit(PROGRESS_EVENT, Arguments.createMap().apply {
            putString("downloadId", downloadId)
            putDouble("downloadedBytes", downloaded.toDouble())
            putDouble("totalBytes", total.toDouble())
            putDouble("speed", speed)
        })
    }

    private fun emitState(downloadId: String, state: String, message: String? = null) {
        emit(STATE_EVENT, Arguments.createMap().apply {
            putString("downloadId", downloadId)
            putString("state", state)
            message?.let { putString("message", it) }
        })
    }

    private fun emit(eventName: String, payload: Any) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, payload)
        }
    }

    private fun readableHeaders(headers: ReadableMap?): Map<String, String> {
        if (headers == null) return emptyMap()
        val result = mutableMapOf<String, String>()
        val iterator = headers.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            headers.getString(key)?.let { result[key] = it }
        }
        return result
    }

    private fun parseContentRangeStart(value: String?): Long {
        return Regex("bytes\\s+(\\d+)-", RegexOption.IGNORE_CASE)
            .find(value ?: "")?.groupValues?.getOrNull(1)?.toLongOrNull() ?: -1L
    }

    private fun parseContentRangeTotal(value: String?): Long {
        return Regex("/(\\d+)$").find(value ?: "")
            ?.groupValues?.getOrNull(1)?.toLongOrNull() ?: -1L
    }

    private fun parseUnsatisfiedTotal(value: String?): Long = parseContentRangeTotal(value)
}

private class HttpStatusException(val status: Int) : IOException("HTTP $status")
private class SegmentedUnsupportedException(message: String) : IOException(message)
private class DestinationException(message: String, cause: Throwable) : IOException(message, cause)
