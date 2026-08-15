# Upstream defect: react-native-blob-util violates Okio's Source contract

## Symptom

Relay uses `react-native-blob-util` to download files from the backend.
During physical-device testing (Milestones P7–P10, see
`docs/15_QA_NOTEBOOK.md`), downloads failed unpredictably: small files
usually succeeded, large files often truncated with no exception anywhere
(not in Java, JS, or OkHttp). The failing file types changed between test
runs, ruling out MIME type, extension, or backend logic as the cause.

## Root cause

The download path traces: FastAPI `StreamingResponse` → OkHttp →
`ReactNativeBlobUtilFileResp` → `ProgressReportingSource.read()` → file
output stream → MediaStore.

`ProgressReportingSource.read(Buffer sink, long byteCount)` violates
Okio's `Source` contract: it reads bytes from OkHttp and writes them
directly to the destination file, then returns the byte count read — but
never copies those bytes into the `sink` buffer Okio's contract requires.
Okio expects that if `read()` returns N bytes, `sink` contains those N
bytes; here `sink` stayed empty. Okio's buffered layer therefore saw an
empty `sink` after the very first physical socket read and concluded
end-of-stream — the download silently terminated after one read, with no
exception thrown at any layer.

**Why failures looked random:** whether a download completed depended
entirely on how many bytes arrived in that first OS socket read. If the
whole file arrived in one read, it succeeded; otherwise it truncated. The
failures correlated with transfer timing/socket behavior, not file type —
which is why the symptom kept shifting between test runs.

## Fix

Add the missing `sink.write(bytes, 0, (int) read)` call immediately after
writing to the output stream, keeping Okio's internal buffer consistent
with the returned byte count. Applied via `patch-package`:
`android/patches/react-native-blob-util+0.24.10.patch`, applied
automatically on every `npm install`.

## Verification

Verified on RMX3997 (Android 16): 8 real file types (txt, pdf, docx,
pptx, jpg, png, mp3, zip) and synthetic files from 64 KB–32 MB, multiple
consecutive transfers, all byte-for-byte correct.

## Upgrade note

Whenever `react-native-blob-util` is upgraded: check whether this
upstream defect has been fixed; if so, remove the patch — but only after
re-running the full physical-device transfer matrix above.
