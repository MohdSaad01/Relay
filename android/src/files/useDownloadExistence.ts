import { useCallback, useRef, useState } from 'react';
import { downloadedFileExists } from './downloadExistence';

/**
 * An on-device existence cache, keyed by file name, for files the backend
 * reports as a completed download — not a parallel download-status tracker.
 * deriveDownloadStatus (downloadStatus.ts) remains the single source of
 * truth for idle/pending/in_progress/failed/completed; this only answers
 * "is a reported-completed download still actually there," so a screen can
 * pass its result back into deriveDownloadStatus to downgrade a stale
 * 'completed' to 'idle'.
 *
 * `verify` is safe to call repeatedly (e.g. once per poll tick) — the
 * `checking` set only dedupes concurrent in-flight checks for the same file,
 * it doesn't cache "already confirmed" forever, since the file can be
 * deleted at any time after a prior check found it present.
 */
export function useDownloadExistence() {
  const [existence, setExistence] = useState<Record<string, boolean>>({});
  const checking = useRef<Set<string>>(new Set());

  const verify = useCallback((fileName: string) => {
    if (checking.current.has(fileName)) {
      return;
    }
    checking.current.add(fileName);
    downloadedFileExists(fileName)
      .then(exists => {
        setExistence(prev => (prev[fileName] === exists ? prev : { ...prev, [fileName]: exists }));
      })
      .finally(() => {
        checking.current.delete(fileName);
      });
  }, []);

  return { existence, verify };
}
