# react-native-blob-util Okio Source Contract Violation

## Background

Relay uses react-native-blob-util to download files from the backend.

During physical-device testing (P7–P10), downloads appeared to fail randomly.

Small files usually succeeded.

Large files often truncated without any exception.

The failing file types changed between test runs.

This eliminated MIME type, file extension and backend logic as possible causes.

---

## Investigation

The download path was traced end-to-end:

FastAPI
↓

StreamingResponse

↓

OkHttp

↓

ReactNativeBlobUtilFileResp

↓

ProgressReportingSource.read()

↓

File output stream

↓

MediaStore

Instrumentation showed:

- backend always transmitted the complete file
- socket stayed healthy
- no Java exception
- no JS exception
- no OkHttp exception

Yet downloads stopped after exactly one physical socket read.

---

## Root Cause

The implementation of

ProgressReportingSource.read(Buffer sink, long byteCount)

violated Okio's Source contract.

The implementation:

1. Read bytes from OkHttp.
2. Wrote them directly to the destination file.
3. Returned the number of bytes read.

However, it never copied those bytes into the supplied Buffer (`sink`).

Okio expects:

> If read() returns N bytes,
> the sink must contain those N bytes.

Instead:

returned bytes > 0

sink remained empty


Therefore the next buffered read immediately encountered an empty buffer and returned EOF.

The stream terminated after the first socket read.

No exception was thrown.

---

## Why failures looked random

Whether the download completed depended entirely on how many bytes happened to arrive during the first operating-system socket read.

If the whole file arrived:

success

Otherwise:

truncated download

Therefore the observed failures correlated with transfer timing and socket behavior rather than file type.

---

## Fix

Immediately after writing to the output stream:

```java
sink.write(bytes, 0, (int) read);
```

This keeps Okio's internal buffer consistent with the returned byte count.

The download loop then continues normally until the real end of the stream.

Persistence

The fix is stored using patch-package.

patches/
react-native-blob-util+0.24.10.patch

The patch is automatically applied after every npm install.

Verification

Verified on:

RMX3997 (Android 16)

Transfers verified:

txt
pdf
docx
pptx
jpg
png
mp3
zip

Synthetic files:

64 KB

512 KB

1 MB

2 MB

4 MB

8 MB

16 MB

32 MB

Multiple consecutive transfers completed successfully with byte-for-byte verification.

Upgrade Note

Whenever react-native-blob-util is upgraded:

Check whether this upstream defect has been fixed.
If fixed, remove the patch.
Re-run the complete physical-device transfer matrix before deleting the patch.