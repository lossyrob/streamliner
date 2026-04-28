const COPILOT_SDK_SESSION_FS_MARKER = "/.streamliner/state/copilot-sdk-session-fs";

export function isCopilotSdkSessionFsPath(path: string | null | undefined): boolean {
  if (!path) {
    return false;
  }
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
  const markerIndex = normalized.indexOf(COPILOT_SDK_SESSION_FS_MARKER);
  if (markerIndex < 0) {
    return false;
  }
  const nextCharacter = normalized.charAt(markerIndex + COPILOT_SDK_SESSION_FS_MARKER.length);
  return nextCharacter === "" || nextCharacter === "/";
}
