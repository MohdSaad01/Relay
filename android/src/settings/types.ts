/**
 * Where Relay publishes a completed download to (P14.3). `default` is the
 * existing, unconfigured behavior (public MediaStore Downloads/Relay on
 * API 29+, private staging below it — unchanged from pre-P14.3). `custom`
 * is a user-picked SAF tree (react-native-saf-x's openDocumentTree),
 * persisted so downloads keep landing there across app restarts.
 *
 * This is a purely client-side Android preference — unrelated to the
 * backend's own AppSettings.download_directory (docs/13_Database_Design.md
 * §6), which configures the *desktop's* download folder for uploads it
 * receives, a different device and a different direction entirely.
 */
export type DownloadLocation =
  | { mode: 'default' }
  | { mode: 'custom'; treeUri: string; displayName: string };
