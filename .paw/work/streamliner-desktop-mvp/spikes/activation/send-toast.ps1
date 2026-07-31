param(
  [string]$Id = ([guid]::NewGuid().ToString('n')),
  [string]$Title = 'Streamliner activation spike',
  [string]$Message = 'Click this toast to test protocol activation.',
  [switch]$Silent
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Aumid = 'Streamliner.Spike.Activation'
$Uri = "streamliner-spike://notification/${Id}?source=toast"
$sendLog = Join-Path $Root 'send-log.ndjson'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AppIdUtil {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
  public static extern void SetCurrentProcessExplicitAppUserModelID(string AppID);
}
"@
[AppIdUtil]::SetCurrentProcessExplicitAppUserModelID($Aumid)
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xmlText = @"
<toast activationType="protocol" launch="$Uri">
  <visual>
    <binding template="ToastGeneric">
      <text>$([Security.SecurityElement]::Escape($Title))</text>
      <text>$([Security.SecurityElement]::Escape($Message))</text>
    </binding>
  </visual>
</toast>
"@
$doc = [Windows.Data.Xml.Dom.XmlDocument]::new()
$doc.LoadXml($xmlText)
$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
$toast.Tag = $Id.Substring(0, [Math]::Min(16,$Id.Length))
$toast.Group = 'streamliner-spike'
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid)
$notifier.Show($toast)
[ordered]@{ timestamp=(Get-Date).ToString('o'); id=$Id; uri=$Uri; aumid=$Aumid; title=$Title; message=$Message; pid=$PID } | ConvertTo-Json -Compress | Add-Content -LiteralPath $sendLog -Encoding utf8
if (-not $Silent) { "Sent toast id=$Id uri=$Uri" }

