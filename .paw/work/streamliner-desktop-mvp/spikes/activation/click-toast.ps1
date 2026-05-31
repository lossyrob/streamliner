param(
  [string]$NameContains = 'Streamliner activation spike',
  [switch]$OpenNotificationCenter,
  [int]$TimeoutSeconds = 25
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$evidence = Join-Path $Root 'clicker-evidence.txt'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class KeyUtil {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const int KEYEVENTF_KEYUP = 0x2;
  public const byte VK_LWIN = 0x5B;
  public const byte VK_N = 0x4E;
}
"@
function Write-Evidence($msg) { Add-Content -LiteralPath $evidence -Value ("{0}`t{1}" -f (Get-Date).ToString('o'), $msg) -Encoding utf8 }
if ($OpenNotificationCenter) {
  [KeyUtil]::keybd_event([KeyUtil]::VK_LWIN,0,0,[UIntPtr]::Zero)
  [KeyUtil]::keybd_event([KeyUtil]::VK_N,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 100
  [KeyUtil]::keybd_event([KeyUtil]::VK_N,0,[KeyUtil]::KEYEVENTF_KEYUP,[UIntPtr]::Zero)
  [KeyUtil]::keybd_event([KeyUtil]::VK_LWIN,0,[KeyUtil]::KEYEVENTF_KEYUP,[UIntPtr]::Zero)
  Start-Sleep -Seconds 1
  Write-Evidence 'Opened notification center with Win+N'
}
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$rootEl = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $NameContains)
while ((Get-Date) -lt $deadline) {
  $matches = $rootEl.FindAll([System.Windows.Automation.TreeScope]::Subtree, $cond)
  if ($matches.Count -gt 0) {
    $el = $matches.Item(0)
    Write-Evidence "Found exact element '$($el.Current.Name)' class=$($el.Current.ClassName) control=$($el.Current.ControlType.ProgrammaticName)"
    try {
      $invoke = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $invoke.Invoke()
      Write-Evidence 'Invoked element via InvokePattern'
      return
    } catch {
      $pt = $el.GetClickablePoint()
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point([int]$pt.X,[int]$pt.Y)
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MouseUtil { [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra); public const uint LEFTDOWN=0x0002; public const uint LEFTUP=0x0004; }
"@ -ErrorAction SilentlyContinue
      [MouseUtil]::mouse_event([MouseUtil]::LEFTDOWN,0,0,0,[UIntPtr]::Zero)
      Start-Sleep -Milliseconds 50
      [MouseUtil]::mouse_event([MouseUtil]::LEFTUP,0,0,0,[UIntPtr]::Zero)
      Write-Evidence "Clicked element at $($pt.X),$($pt.Y)"
      return
    }
  }
  Start-Sleep -Milliseconds 500
}
Write-Evidence "Timed out finding '$NameContains'"
throw "Timed out finding '$NameContains'"
