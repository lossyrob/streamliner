# Rust Windows Toast Spike Findings

Date: 2026-05-30
Machine: Windows 11 build 26200, cargo 1.93.1, rustc 1.93.1

## Comparison

| crate/path | arbitrary XML? | per-notification image? | activation? | maturity | effort |
| --- | --- | --- | --- | --- | --- |
| Raw `windows` crate | Yes. Direct `XmlDocument::LoadXml` accepts any ToastGeneric XML supported by Windows. | Yes. Generate image files per toast and reference them from XML (`file:///...`). Spike used `appLogoOverride` and `hint-crop="none"`. | Yes. Use `activationType="protocol" launch="..."` for reliable process relaunch, or attach WinRT events for in-process callbacks while alive. | Official Microsoft WinRT projection; low abstraction, stable API surface. | Medium. Must own XML escaping, AUMID registration, image lifetime, protocol registration. |
| `tauri-winrt-notification` 0.7.2 | No public arbitrary-XML API. It internally builds a fixed ToastGeneric XML string. Its `examples/without_library.rs` demonstrates dropping down to raw `windows` for arbitrary XML. | Yes for its supported slots: `icon`, `hero`, `image`; `icon` emits `placement="appLogoOverride"`. | Partial. Has `on_activated`/`on_dismissed` handlers and `add_button(arguments)`, but the public builder does not expose root `activationType="protocol"`/`launch` for durable relaunch activation. In-process event handlers require the process to remain alive. | Maintained Tauri fork of the older crate. Uses `windows` 0.61 and documents unpackaged AppUserModelId registry registration. | Low for conventional toasts, but becomes raw `windows` for Streamliner's required design/activation flexibility. |
| `winrt-notification` 0.5.1 | No public arbitrary-XML API. It internally builds ToastGeneric XML; its example also has a raw `windows` "without_library" path. | Yes for `icon`, `hero`, `image`. | Limited/older. Crate description says "incomplete wrapper"; public API is primarily builder/show. Not the best base for reliable desktop companion activation. | Older upstream crate, superseded in practice by Tauri fork. | Low for simple toasts; not enough flexibility. |
| `tauri-plugin-notification` 2.3.3 | No. Desktop implementation maps to `notify_rust::Notification` fields. No ToastGeneric XML access. | Limited. Builder has `icon`, but desktop code only passes it to `notify-rust`; `attachment`, `large_icon`, etc. are ignored by desktop implementation. Not per-toast appLogoOverride XML. | Limited. Rust desktop `show()` fire-and-forgets `notification.show()` on an async task and does not expose toast click callback/launch forwarding. Action APIs are not used by the Windows desktop path inspected. | Official Tauri plugin, good for cross-platform basic notifications. Donna uses it only as `.title().body().show()`. | Very low for basic notifications, but wrong abstraction for custom Streamliner toasts. |

Donna verification: `C:\Users\robemanuele\proj\pal\personal-agent-layer\donna\desktop\src-tauri\Cargo.toml` uses `tauri-plugin-notification = "2"`; usage in `main.rs`, `dictation.rs`, and `tray.rs` is basic `.notification().builder().title(...).body(...).show()`.

## Working minimal spike

Project kept at:

`C:\Users\robemanuele\proj\streamliner\streamliner-desktop-mvp\.paw\work\streamliner-desktop-mvp\spikes\rust-native\toast-spike\`

It is a plain binary crate. It:

1. Generates a PNG per run.
2. Registers `HKCU\Software\Classes\AppUserModelId\com.streamliner.toastspike` for the AUMID/display/icon.
3. Registers `HKCU\Software\Classes\streamliner-toast-spike` as a protocol handler.
4. Loads arbitrary ToastGeneric XML through `Windows.Data.Xml.Dom.XmlDocument`.
5. Shows it through `Windows.UI.Notifications.ToastNotificationManager::CreateToastNotifierWithId`.
6. Uses `<toast activationType="protocol" launch="streamliner-toast-spike://...">` so clicking can relaunch the exe with the URL.

Validation run:

```text
cargo build: initial dev build 35.242s; incremental rebuilds 5.797s and 2.364s
cargo run: Show() returned OK and printed "Displayed toast using AUMID com.streamliner.toastspike"
manual protocol activation: Start-Process streamliner-toast-spike://manual-activation-test?final=1 wrote activation.log
release build: 33.694s, release exe 324,608 bytes; debug exe 807,424 bytes
```

Final activation log tail included:

```text
SystemTime { intervals: 134246667003991387 }: streamliner-toast-spike://manual-activation-test/?final=1
```

AUMID registry after the run:

```text
DisplayName: Streamliner Toast Spike
IconUri: C:\Users\robemanuele\proj\streamliner\streamliner-desktop-mvp\.paw\work\streamliner-desktop-mvp\spikes\rust-native\toast-spike\target\debug\toast-spike-state\streamliner-generated-logo.png
IconBackgroundColor: 0
```

### Exact Cargo.toml

```toml
[package]
name = "toast-spike"
version = "0.1.0"
edition = "2024"

[dependencies]
png = "0.17"
windows = { version = "0.58", features = [
  "Data_Xml_Dom",
  "UI_Notifications",
] }
winreg = "0.52"
```

Minimum raw-toast `windows` features needed for this path are:

- `Data_Xml_Dom` for `XmlDocument`.
- `UI_Notifications` for `ToastNotification` and `ToastNotificationManager`.

The spike used `winreg` only for AUMID/protocol registration and `png` only to prove generated per-notification imagery.

### Exact main.rs

```rust
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use windows::core::HSTRING;
use windows::Data::Xml::Dom::XmlDocument;
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const AUMID: &str = "com.streamliner.toastspike";
const PROTOCOL: &str = "streamliner-toast-spike";

fn main() -> windows::core::Result<()> {
    if let Some(arg) = env::args().nth(1) {
        if arg.starts_with(&format!("{PROTOCOL}:")) {
            log_activation(&arg);
            return Ok(());
        }
    }

    let exe = env::current_exe().expect("current exe path");
    let state_dir = state_dir();
    fs::create_dir_all(&state_dir).expect("create state dir");
    let logo = state_dir.join("streamliner-generated-logo.png");
    write_generated_logo(&logo).expect("write generated logo");
    register_aumid(&logo).expect("register AppUserModelID");
    register_protocol(&exe).expect("register protocol handler");

    let launch_url = format!(
        "{PROTOCOL}://toast-click?source=raw-windows-crate&pid={}",
        std::process::id()
    );
    let xml = build_toast_xml(&logo, &launch_url);
    let doc = XmlDocument::new()?;
    doc.LoadXml(&HSTRING::from(xml))?;
    let toast = ToastNotification::CreateToastNotification(&doc)?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(AUMID))?;
    notifier.Show(&toast)?;

    println!("Displayed toast using AUMID {AUMID}");
    println!("Click launch URL: {launch_url}");
    println!("Generated image: {}", logo.display());
    println!("Activation log: {}", state_dir.join("activation.log").display());
    Ok(())
}

fn build_toast_xml(logo: &Path, launch_url: &str) -> String {
    let logo_uri = file_uri(logo);
    let escaped_launch = escape_xml(launch_url);
    let escaped_logo = escape_xml(&logo_uri);
    format!(
        r#"<toast activationType="protocol" launch="{escaped_launch}">
  <visual>
    <binding template="ToastGeneric">
      <text>Streamliner raw WinRT toast spike</text>
      <text>Custom ToastGeneric XML with a generated appLogoOverride.</text>
      <image placement="appLogoOverride" hint-crop="none" src="{escaped_logo}"/>
      <text placement="attribution">Streamliner capability spike</text>
    </binding>
  </visual>
</toast>"#
    )
}

fn file_uri(path: &Path) -> String {
    let absolute = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let path = absolute.to_string_lossy().replace('\\', "/");
    format!("file:///{}", path.replace(' ', "%20"))
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn register_protocol(exe: &Path) -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(format!(r"Software\Classes\{PROTOCOL}"))?;
    key.set_value("", &"URL:Streamliner Toast Spike")?;
    key.set_value("URL Protocol", &"")?;
    let (command, _) = hkcu.create_subkey(format!(r"Software\Classes\{PROTOCOL}\shell\open\command"))?;
    command.set_value("", &format!("\"{}\" \"%1\"", exe.display()))?;
    Ok(())
}

fn register_aumid(icon: &Path) -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(format!(r"Software\Classes\AppUserModelId\{AUMID}"))?;
    key.set_value("DisplayName", &"Streamliner Toast Spike")?;
    key.set_value("IconUri", &icon.display().to_string())?;
    key.set_value("IconBackgroundColor", &"0")?;
    Ok(())
}

fn state_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("toast-spike-state")
}

fn log_activation(url: &str) {
    let state_dir = state_dir();
    let _ = fs::create_dir_all(&state_dir);
    let log_path = state_dir.join("activation.log");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .expect("open activation log");
    let _ = writeln!(file, "{:?}: {url}", std::time::SystemTime::now());
}

fn write_generated_logo(path: &Path) -> std::io::Result<()> {
    let file = fs::File::create(path)?;
    let mut encoder = png::Encoder::new(file, 96, 96);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header()?;
    let mut data = Vec::with_capacity(96 * 96 * 4);
    for y in 0..96u32 {
        for x in 0..96u32 {
            let border = x < 5 || y < 5 || x > 90 || y > 90;
            let diagonal = x.abs_diff(y) < 5 || (x + y > 90 && x + y < 102);
            let (r, g, b, a) = if border {
                (0x38, 0xbd, 0xff, 0xff)
            } else if diagonal {
                (0xff, 0xff, 0xff, 0xff)
            } else {
                (0x16, 0x1b, 0x22, 0xff)
            };
            data.extend_from_slice(&[r, g, b, a]);
        }
    }
    writer.write_image_data(&data)?;
    Ok(())
}
```

## Tauri v2 integration notes

- Recommendation is to implement a small Windows-only Rust module in the Tauri app using raw `windows` APIs for Streamliner companion toasts. Gate it behind `#[cfg(target_os = "windows")]` and expose an internal command/service like `show_streamliner_toast(xml_or_model)`.
- This can coexist with `tauri-plugin-notification` for simple cross-platform notifications, but for Windows Streamliner notifications it should replace the plugin path. The plugin is intentionally basic and hides the WinRT XML/activation model.
- AUMID must be stable and match the app identifier. For packaged/MSIX builds, identity handles this. For unpackaged/dev or NSIS/MSI-style installs, register `HKCU\Software\Classes\AppUserModelId\<AUMID>` (modern documented route) or create a Start Menu shortcut with `System.AppUserModel.ID`. The Tauri installer/setup path is the right place; the spike did it at runtime only for proof.
- Protocol activation is the most reliable click path. Register a custom protocol in Tauri config/installer, set `activationType="protocol" launch="streamliner://notification/<id>"`, and handle the URL in the app's single-instance/open-url path. This survives process not running. In-process WinRT `Activated` handlers are useful only while the process remains alive and subscribed.
- Keep generated images in an app data/cache directory long enough for Windows to render and retain the notification. Do not delete immediately after `Show()`.
- Threading: the spike called WinRT from a normal Rust main thread. In Tauri, call from setup, commands, or background tasks; no webview/UI thread dependency. If adding event handlers, keep handler tokens/objects alive as long as needed.
- Binary/compile impact in this minimal crate was modest: release exe 324 KB. Initial dev/release builds were about 35/34 seconds mostly due to first compilation of `windows` proc-macro/support crates and `png`; incremental rebuild was 2-6 seconds. A Tauri app may already depend on Windows crates, reducing marginal cost. If image generation is done elsewhere, `png` is optional.

## Recommendation

Use raw `windows` crate APIs for the desktop app's Windows toast layer. It is the only evaluated path that directly supports arbitrary ToastGeneric XML, generated per-notification imagery in any supported toast slot, and durable protocol click activation. `tauri-winrt-notification` is acceptable for conventional toasts but becomes a wrapper to work around; `tauri-plugin-notification` is a cross-platform basic notification API and is too limited for Streamliner's desired custom toast design.
