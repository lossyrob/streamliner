param([switch]$Cleanup)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Aumid = 'Streamliner.Spike.Activation'
$ShortcutName = 'Streamliner Activation Spike.lnk'
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) $ShortcutName
$Scheme = 'streamliner-spike'
$Sender = Join-Path $Root 'send-toast.ps1'
$Handler = Join-Path $Root 'handler.ps1'
$Registrar = Join-Path $Root 'register-shortcut.exe'
$Pwsh = (Get-Command pwsh.exe).Source

if ($Cleanup) {
  Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction SilentlyContinue
  Remove-Item -Path "HKCU:\Software\Classes\$Scheme" -Recurse -Force -ErrorAction SilentlyContinue
  "Removed shortcut: $ShortcutPath" | Set-Content -LiteralPath (Join-Path $Root 'cleanup-evidence.txt') -Encoding utf8
  "Removed registry key: HKCU:\Software\Classes\$Scheme" | Add-Content -LiteralPath (Join-Path $Root 'cleanup-evidence.txt') -Encoding utf8
  return
}

$argsForShortcut = "-NoProfile -ExecutionPolicy Bypass -File `"$Sender`""
& $Registrar $ShortcutPath $Pwsh $argsForShortcut $Root $Handler | Tee-Object -FilePath (Join-Path $Root 'registration-native-output.txt')
if ($LASTEXITCODE -ne 0) { throw "register-shortcut.exe failed with $LASTEXITCODE" }
$cmd = (Get-ItemProperty -Path "HKCU:\Software\Classes\$Scheme\shell\open\command" -Name '(default)').'(default)'
[ordered]@{
  timestamp = (Get-Date).ToString('o')
  aumid = $Aumid
  shortcut = $ShortcutPath
  shortcutExists = (Test-Path -LiteralPath $ShortcutPath)
  scheme = $Scheme
  command = $cmd
  user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $Root 'registration-evidence.json') -Encoding utf8
"Registered AUMID shortcut: $ShortcutPath"
"Registered protocol: HKCU:\Software\Classes\$Scheme"
"Command: $cmd"
