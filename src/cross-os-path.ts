import { win32 as pathWin32 } from "node:path";

/**
 * Returns the final path segment of a recorded working-directory or file path,
 * treating both POSIX (`/`) and Windows (`\`) separators as boundaries.
 *
 * Session records may carry paths captured on a different operating system than
 * the one currently running Streamliner (e.g. a Windows `C:\Users\me\proj`
 * launched session inspected from macOS). `node:path`'s platform-native
 * `basename` only splits on the host separator, so a Windows path on POSIX would
 * be returned whole. `path.win32.basename` accepts both separators on every
 * platform, which is what we want for deriving display titles from foreign paths.
 *
 * This is intended for human-facing derivations (titles), not for filesystem
 * access, so the rare case of a POSIX filename containing a literal backslash is
 * an acceptable trade-off.
 */
export function basenameCrossOs(targetPath: string): string {
  return pathWin32.basename(targetPath);
}
