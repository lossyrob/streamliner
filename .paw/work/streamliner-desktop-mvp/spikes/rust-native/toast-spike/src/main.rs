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
