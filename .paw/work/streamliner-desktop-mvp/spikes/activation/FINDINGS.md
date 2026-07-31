# Toast activation spike findings

Date: 2026-05-30
Machine: Windows 11 build 26200
Spike directory: `C:\Users\robemanuele\proj\streamliner\streamliner-desktop-mvp\.paw\work\streamliner-desktop-mvp\spikes\activation`

## Verdict

Protocol activation is the reliable unpackaged path on this machine. A toast sent with AUMID `Streamliner.Spike.Activation` and XML `activationType="protocol" launch="streamliner-spike://notification/<id>?source=toast"` launched the registered per-user protocol handler when clicked from both the popup and Notification Center. The Notification Center evidence also covers post-sender-exit activation because `send-toast.ps1` had already exited before the click.

## Evidence

AUMID shortcut registration was verified by reading `PKEY_AppUserModel_ID` from the generated Start Menu shortcut:

```text
AppUserModelID=Streamliner.Spike.Activation

```

Registration evidence:

```json
{
  "timestamp": "2026-05-30T22:03:54.1749351-04:00",
  "aumid": "Streamliner.Spike.Activation",
  "shortcut": "C:\\Users\\robemanuele\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Streamliner Activation Spike.lnk",
  "shortcutExists": true,
  "scheme": "streamliner-spike",
  "command": "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -NoProfile -ExecutionPolicy Bypass -File \"C:\\Users\\robemanuele\\proj\\streamliner\\streamliner-desktop-mvp\\.paw\\work\\streamliner-desktop-mvp\\spikes\\activation\\handler.ps1\" \"%1\"",
  "user": "NORTHAMERICA\\robemanuele",
  "isAdmin": false
}

```

Send log excerpts:

```json
﻿{"timestamp":"2026-05-30T22:05:09.1704209-04:00","id":"smoke-ps5","uri":"streamliner-spike://notification/=toast","aumid":"Streamliner.Spike.Activation","title":"Streamliner activation spike","message":"Smoke test from Windows PowerShell","pid":49124}
{"timestamp":"2026-05-30T22:05:20.2688983-04:00","id":"popup-001","uri":"streamliner-spike://notification/popup-001?source=toast","aumid":"Streamliner.Spike.Activation","title":"Streamliner activation spike","message":"Popup click test popup-001","pid":5904}
{"timestamp":"2026-05-30T22:06:01.5450608-04:00","id":"center-dump-001","uri":"streamliner-spike://notification/center-dump-001?source=toast","aumid":"Streamliner.Spike.Activation","title":"Streamliner activation spike","message":"Center dump test center-dump-001","pid":86672}
{"timestamp":"2026-05-30T22:07:50.4506332-04:00","id":"screenshot-001","uri":"streamliner-spike://notification/screenshot-001?source=toast","aumid":"Streamliner.Spike.Activation","title":"Streamliner activation spike","message":"Screenshot test screenshot-001","pid":18052}
{"timestamp":"2026-05-30T22:08:15.3421607-04:00","id":"popup-click-001","uri":"streamliner-spike://notification/popup-click-001?source=toast","aumid":"Streamliner.Spike.Activation","title":"Streamliner Activation Spike","message":"Popup click evidence popup-click-001","pid":35672}
{"timestamp":"2026-05-30T22:08:31.0868383-04:00","id":"action-center-001","uri":"streamliner-spike://notification/action-center-001?source=toast","aumid":"Streamliner.Spike.Activation","title":"Streamliner Activation Spike","message":"Action Center evidence action-center-001","pid":73828}
{"timestamp":"2026-05-30T22:10:00.8484639-04:00","id":"action-center-002","uri":"streamliner-spike://notification/action-center-002?source=toast","aumid":"Streamliner.Spike.Activation","title":"Streamliner Activation Spike","message":"Action Center evidence action-center-002","pid":60728}
{"timestamp":"2026-05-30T22:10:44.7063599-04:00","id":"action-uia-001","uri":"streamliner-spike://notification/action-uia-001?source=toast","aumid":"Streamliner.Spike.Activation","title":"Streamliner Activation Spike","message":"Action UIA evidence action-uia-001","pid":28452}
{"timestamp":"2026-05-30T22:12:03.6128656-04:00","id":"post-exit-001","uri":"streamliner-spike://notification/post-exit-001?source=toast","aumid":"Streamliner.Spike.Activation","title":"Streamliner Activation Spike","message":"Post-exit evidence post-exit-001","pid":98664}

```

Activation log evidence:

```text
2026-05-30T22:07:41.4258329-04:00	PID=92656	ARGS=streamliner-spike://notification/direct-shell-001?source=direct	CMD="C:\Program Files\PowerShell\7\pwsh.dll" -NoProfile -ExecutionPolicy Bypass -File C:\Users\robemanuele\proj\streamliner\streamliner-desktop-mvp\.paw\work\streamliner-desktop-mvp\spikes\activation\handler.ps1 streamliner-spike://notification/direct-shell-001?source=direct
2026-05-30T22:08:18.0923011-04:00	PID=70684	ARGS=streamliner-spike://notification/popup-click-001?source=toast	CMD="C:\Program Files\PowerShell\7\pwsh.dll" -NoProfile -ExecutionPolicy Bypass -File C:\Users\robemanuele\proj\streamliner\streamliner-desktop-mvp\.paw\work\streamliner-desktop-mvp\spikes\activation\handler.ps1 streamliner-spike://notification/popup-click-001?source=toast
2026-05-30T22:10:14.2118798-04:00	PID=46632	ARGS=streamliner-spike://notification/action-center-002?source=toast	CMD="C:\Program Files\PowerShell\7\pwsh.dll" -NoProfile -ExecutionPolicy Bypass -File C:\Users\robemanuele\proj\streamliner\streamliner-desktop-mvp\.paw\work\streamliner-desktop-mvp\spikes\activation\handler.ps1 streamliner-spike://notification/action-center-002?source=toast

```

Key proof points:

- Popup click: `popup-click-001` was sent at 2026-05-30T22:08:15 and the protocol handler logged `streamliner-spike://notification/popup-click-001?source=toast` at 2026-05-30T22:08:18.
- Notification Center after popup expired: `action-center-002` was sent at 2026-05-30T22:10:00, Notification Center was opened and clicked at 2026-05-30T22:10:10, and the handler logged `streamliner-spike://notification/action-center-002?source=toast` at 2026-05-30T22:10:14.
- Post-exit: `action-center-002` also proves post-sender-exit behavior. The sender was a short-lived Windows PowerShell process that returned immediately after `ToastNotificationManager.CreateToastNotifier(AUMID).Show(toast)`. The later Notification Center click caused Windows to launch a new protocol-handler process (`pwsh.dll ... handler.ps1 ... action-center-002`).
- Direct protocol sanity check: `Start-Process streamliner-spike://notification/direct-shell-001?source=direct` logged at 2026-05-30T22:07:41.

Manual click/capture notes:

```text
2026-05-30T22:08:16.6857514-04:00 clicked popup coordinate 3570,2025 for popup-click-001
2026-05-30T22:08:40.3103220-04:00 opened notification center with Win+N for action-center-001 after 9s
2026-05-30T22:09:04.3336063-04:00 clicked clock/date coordinate 3745,2130 to open notification center
2026-05-30T22:09:19.3898671-04:00 clicked notification center coordinate 3540,193 for action-center-001
2026-05-30T22:10:10.1060688-04:00 opened notification center by clock for action-center-002
2026-05-30T22:10:10.2636408-04:00 clicked notification center body coordinate 3580,245 for action-center-002
2026-05-30T22:12:03.7242354-04:00 sender process exited with code 0 for post-exit-001
2026-05-30T22:12:17.3597041-04:00 opened notification center after sender exit for post-exit-001
2026-05-30T22:12:17.5357412-04:00 clicked notification center body coordinate 3580,245 for post-exit-001

```

Screenshots captured:

- `toast-popup-screenshot.png` - visible attributed toast popup.
- `notification-center-open.png` - Notification Center contained `Streamliner Activation Spike` / `action-center-001`.
- `action-center-after-second-click.png` - the click returned focus to a terminal after activation.
- `post-exit-before-click.png` - attempted extra post-exit capture; this specific attempt did not produce a new handler log because the click/open sequence missed the notification, but `action-center-002` already covered post-exit.

## Toasty's baseline approach

Toasty (`C:\Users\robemanuele\proj\util\toasty\main.cpp`) uses the same recommended baseline:

1. Defines `APP_ID = L"Toasty.CLI.Notification"` and `PROTOCOL_NAME = L"toasty"`.
2. Creates `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Toasty.lnk` with `IShellLinkW` and `IPersistFile`.
3. Sets the shortcut's `PKEY_AppUserModel_ID` through `IPropertyStore` / `InitPropVariantFromString(APP_ID, &pv)`.
4. Registers `HKCU\Software\Classes\toasty` with `URL Protocol` and command `"<toasty.exe>" --focus "%1"`.
5. Calls `SetCurrentProcessExplicitAppUserModelID(APP_ID)` before sending.
6. Sends toast XML like `<toast activationType="protocol" launch="toasty://focus">...` through `Windows.UI.Notifications.ToastNotificationManager::CreateToastNotifier(APP_ID)`.
7. On click, Windows launches the protocol handler, and Toasty focuses the previously saved terminal window.

This is protocol activation plus AUMID attribution; no COM toast activator is used.

## Exact unpackaged registration steps

1. Choose a stable AUMID, e.g. `com.streamliner.desktop` or `Streamliner.Desktop`.
2. Create a per-user Start Menu shortcut under `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Streamliner.lnk` pointing at the installed desktop executable.
3. Set shortcut property `System.AppUserModel.ID` (`PKEY_AppUserModel_ID`) to the same AUMID using `IShellLinkW` + `IPropertyStore`.
4. At runtime before sending toasts, call `SetCurrentProcessExplicitAppUserModelID(AUMID)`.
5. Register a per-user URL scheme under `HKCU\Software\Classes\streamliner` (or similar):
   - default value: `URL:Streamliner Protocol`
   - `URL Protocol` empty string value
   - `shell\open\command` default: `"C:\Path\To\Streamliner.exe" "--notification-activation" "%1"`
6. Send toast XML with protocol launch, e.g. `<toast activationType="protocol" launch="streamliner://notification/<id>?...">`.
7. On process start, parse protocol/activation arguments and route into the running app if one exists, or start normally and handle the activation if not.

## Admin / UAC / scope

No admin was required. The spike ran as `NORTHAMERICA\robemanuele` with `isAdmin: false`. Both the Start Menu shortcut and URL scheme were per-user:

- Shortcut: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Streamliner Activation Spike.lnk`
- Registry: `HKCU\Software\Classes\streamliner-spike`

Per-machine registration would require machine-wide locations and likely elevation, but is unnecessary for a user-installed Streamliner/Tauri app.

## COM activator feasibility

COM activation is feasible for unpackaged Win32/Rust, but it is much higher risk than protocol activation. The unpackaged COM path requires:

- Implementing `INotificationActivationCallback` in a local COM server.
- Registering a CLSID under HKCU/HKLM `Software\Classes\CLSID\{...}` with `LocalServer32` pointing at the app executable.
- Adding a `ToastActivatorCLSID` property to the AUMID Start Menu shortcut in addition to `PKEY_AppUserModel_ID`.
- Ensuring the executable can register/unregister and run as both the normal app and the COM local server, including threading/apartment and lifetime details.
- Handling activation when no app process is running and marshaling it back to an existing instance when one is running.

For Rust/Tauri this means direct `windows` crate COM implementation or a helper executable/library. It buys richer in-app activation arguments but adds fragile COM registration, CLSID lifetime, and installer/uninstaller burden. I did not build it because protocol activation satisfied all reliability cases with less surface area.

## Cleanup performed

Copied the generated `.lnk` into this evidence folder, then removed live registration:

```text
Removed shortcut: C:\Users\robemanuele\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Streamliner Activation Spike.lnk
Removed registry key: HKCU:\Software\Classes\streamliner-spike

```

Registry snapshot before cleanup is saved in `registry-before-cleanup.txt`. A verification pass confirmed `HKCU:\Software\Classes\streamliner-spike` and the live Start Menu shortcut no longer exist; the evidence copy of the `.lnk` remains in this folder.

## Recommendation

Use protocol activation for the Rust/Tauri Streamliner desktop MVP. Treat it as the primary supported activation path for unpackaged installs. Use a stable AUMID Start Menu shortcut for attribution, register a per-user `streamliner://` protocol handler, and have Tauri route the protocol URL into the already-running instance or perform cold-start handling. Defer COM activator work unless Streamliner later needs Windows-specific action-button semantics that protocol activation cannot provide.
