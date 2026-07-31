param(
  [string]$Aumid = "Microsoft.Windows.Computer",
  [int]$DelayMs = 2500,
  [switch]$One,
  [string]$Case = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ImageDir = Join-Path $Root "images"
New-Item -ItemType Directory -Force -Path $ImageDir | Out-Null

Add-Type -AssemblyName System.Drawing
function New-BadgePng {
  param([string]$Path,[string]$Bg,[string]$Fg,[string]$Text,[int]$W=256,[int]$H=256,[string]$Glyph="")
  $bmp = New-Object System.Drawing.Bitmap($W,$H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml($Bg))
  if ($Glyph) {
    $brushGlyph = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(72, [System.Drawing.ColorTranslator]::FromHtml($Fg)))
    $fontGlyph = New-Object System.Drawing.Font("Segoe UI Symbol", [single]($H*0.46), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sfC = New-Object System.Drawing.StringFormat
    $sfC.Alignment = [System.Drawing.StringAlignment]::Center
    $sfC.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString($Glyph, $fontGlyph, $brushGlyph, (New-Object System.Drawing.RectangleF(0, -8, $W, $H)), $sfC)
  }
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($Fg))
  $font = New-Object System.Drawing.Font("Segoe UI", [single]($H*0.34), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString($Text, $font, $brush, (New-Object System.Drawing.RectangleF(0, 0, $W, $H)), $sf)
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
function New-HeroPng {
  param([string]$Path,[string]$Bg,[string]$Fg,[string]$LeftText,[string]$RightGlyph,[int]$W=728,[int]$H=360)
  $bmp = New-Object System.Drawing.Bitmap($W,$H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml($Bg))
  $accent = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($Fg))
  $dark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70,0,0,0))
  $g.FillRectangle($dark, 0, [int]($H*0.66), $W, [int]($H*0.34))
  $font = New-Object System.Drawing.Font("Segoe UI", [single]54, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $font2 = New-Object System.Drawing.Font("Segoe UI Symbol", [single]150, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString($LeftText, $font, $accent, 34, [int]($H*0.70))
  $sf = New-Object System.Drawing.StringFormat; $sf.Alignment=[System.Drawing.StringAlignment]::Center; $sf.LineAlignment=[System.Drawing.StringAlignment]::Center
  $g.DrawString($RightGlyph, $font2, $accent, (New-Object System.Drawing.RectangleF([single]($W*0.57), 20, [single]($W*0.38), [single]($H*0.55))), $sf)
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

$logoBlue = Join-Path $ImageDir "workstream-blue-ro-circle.png"
$logoOrange = Join-Path $ImageDir "workstream-orange-api-square.png"
$eventDone = Join-Path $ImageDir "event-done-green.png"
$eventBlocked = Join-Path $ImageDir "event-blocked-red.png"
$heroBuild = Join-Path $ImageDir "hero-build-failed.png"
$heroReview = Join-Path $ImageDir "hero-review-ready.png"
New-BadgePng $logoBlue "#2563EB" "#FFFFFF" "RO" 256 256 "⚙"
New-BadgePng $logoOrange "#F97316" "#111827" "API" 256 256 "◆"
New-BadgePng $eventDone "#16A34A" "#FFFFFF" "✓" 256 128 ""
New-BadgePng $eventBlocked "#DC2626" "#FFFFFF" "!" 256 128 ""
New-HeroPng $heroBuild "#111827" "#FACC15" "BUILD FAILED" "⚠" 728 360
New-HeroPng $heroReview "#172554" "#93C5FD" "REVIEW READY" "☑" 728 360

$customAudio = Join-Path $Root "custom-audio-test.wav"
$sampleRate = 8000
$duration = 0.2
$samples = [int]($sampleRate * $duration)
$data = New-Object byte[] ($samples * 2)
for ($i = 0; $i -lt $samples; $i++) {
  $v = [int16]([Math]::Sin(2 * [Math]::PI * 880 * $i / $sampleRate) * 12000)
  [BitConverter]::GetBytes($v).CopyTo($data, $i * 2)
}
$fs = [IO.File]::Create($customAudio)
$bw = New-Object IO.BinaryWriter($fs)
$bw.Write([Text.Encoding]::ASCII.GetBytes("RIFF")); $bw.Write([int](36 + $data.Length)); $bw.Write([Text.Encoding]::ASCII.GetBytes("WAVEfmt "))
$bw.Write([int]16); $bw.Write([int16]1); $bw.Write([int16]1); $bw.Write([int]$sampleRate); $bw.Write([int]($sampleRate * 2)); $bw.Write([int16]2); $bw.Write([int16]16)
$bw.Write([Text.Encoding]::ASCII.GetBytes("data")); $bw.Write([int]$data.Length); $bw.Write($data); $bw.Close()

function Escape-Xml([string]$s) { [System.Security.SecurityElement]::Escape($s) }
function FileUri([string]$p) { (New-Object System.Uri($p)).AbsoluteUri }
function Show-ToastXml {
  param([string]$Name,[string]$Xml)
  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
  $doc.LoadXml($Xml)
  $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
  $toast.Tag = ($Name -replace '[^A-Za-z0-9_.-]','-').Substring(0, [Math]::Min(16, ($Name -replace '[^A-Za-z0-9_.-]','-').Length))
  $toast.Group = "streamliner-spike"
  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid)
  $notifier.Show($toast)
}

[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime] | Out-Null

$tests = [ordered]@{}
$tests["01-logo-circle"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="circle" src="$(FileUri $logoBlue)"/>
  <text>Logo circle: RO workstream</text>
  <text>Round appLogoOverride: best for compact workstream identity.</text>
</binding></visual></toast>
"@
$tests["02-logo-square"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="none" src="$(FileUri $logoOrange)"/>
  <text>Logo square: API workstream</text>
  <text>Square/uncropped appLogoOverride preserves corners and badge shape.</text>
</binding></visual></toast>
"@
$tests["03-hero"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="circle" src="$(FileUri $logoBlue)"/>
  <image placement="hero" src="$(FileUri $heroBuild)"/>
  <text>Renderer workstream</text>
  <text>Build failed after 3 attempts.</text>
  <text placement="attribution">event: build-failed</text>
</binding></visual></toast>
"@
$tests["04-inline-image"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="none" src="$(FileUri $logoOrange)"/>
  <text>API workstream</text>
  <text>Deploy finished; inline event chip below.</text>
  <image src="$(FileUri $eventDone)"/>
  <text placement="attribution">event: deploy-succeeded</text>
</binding></visual></toast>
"@
$tests["05-text-lines-attribution"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="circle" src="$(FileUri $logoBlue)"/>
  <text>Line 1 title styling - bold</text>
  <text>Line 2 body text with enough words to test truncation on the right side of the toast viewport and confirm wrapping/clipping.</text>
  <text>Line 3 body text: rendered in expanded/notification-center view, often not all visible in popup.</text>
  <text>Line 4 body text: low priority, may be clipped in compact popup.</text>
  <text placement="attribution">attribution row: repo/name • event-type</text>
</binding></visual></toast>
"@
$tests["06-actions"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="none" src="$(FileUri $logoOrange)"/>
  <text>Review requested</text><text>Buttons render as action affordances.</text>
</binding></visual><actions>
  <action content="Open" activationType="protocol" arguments="streamliner://open"/>
  <action content="Snooze" activationType="protocol" arguments="streamliner://snooze"/>
  <action content="Done" activationType="protocol" arguments="streamliner://done"/>
  <action content="Mute" activationType="protocol" arguments="streamliner://mute"/>
  <action content="More" activationType="protocol" arguments="streamliner://more"/>
</actions></toast>
"@
$tests["07-progress"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="circle" src="$(FileUri $logoBlue)"/>
  <text>Long running agent</text><text>Progress encodes event state; logo encodes workstream.</text>
  <progress title="Implementation" value="0.62" valueStringOverride="62%" status="Phase 3/5"/>
  <text placement="attribution">event: in-progress</text>
</binding></visual></toast>
"@
$tests["08-groups-subgroups"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="none" src="$(FileUri $logoOrange)"/>
  <text>Adaptive group grid test</text>
  <group>
    <subgroup hint-weight="1"><text hint-style="captionSubtle">WORK</text><text hint-style="base">API</text></subgroup>
    <subgroup hint-weight="1"><text hint-style="captionSubtle">EVENT</text><text hint-style="base">BLOCKED</text></subgroup>
    <subgroup hint-weight="1"><text hint-style="captionSubtle">AGE</text><text hint-style="base">4m</text></subgroup>
  </group>
  <image src="$(FileUri $eventBlocked)"/>
</binding></visual></toast>
"@
$tests["09-audio-silent-custom"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="circle" src="$(FileUri $logoBlue)"/>
  <text>Audio schema test</text><text>Custom audio accepted only with ms-appx/ms-winsoundevent; local file custom audio is unreliable for desktop apps.</text>
</binding></visual><audio src="ms-winsoundevent:Notification.Looping.Alarm" loop="false"/></toast>
"@
$tests["10-spinner-indeterminate"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="circle" src="$(FileUri $logoBlue)"/>
  <text>Indeterminate progress</text><text>No standalone spinner element in ToastGeneric; use progress value="indeterminate".</text>
  <progress title="Waiting for review" value="indeterminate" status="Watching PR"/>
</binding></visual></toast>
"@
$tests["11-unknown-spinner"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="circle" src="$(FileUri $logoBlue)"/>
  <text>Unknown spinner element test</text><text>If spinner renders, it should appear below.</text>
  <spinner/>
</binding></visual></toast>
"@
$tests["12-local-custom-audio"] = @"
<toast><visual><binding template="ToastGeneric">
  <image placement="appLogoOverride" hint-crop="circle" src="$(FileUri $logoBlue)"/>
  <text>Local custom audio test</text><text>Submitted with file URI WAV; visual render is normal.</text>
</binding></visual><audio src="$(FileUri $customAudio)"/></toast>
"@

$log = Join-Path $Root "render-log.txt"
"AUMID=$Aumid $(Get-Date -Format o)" | Set-Content -Encoding UTF8 $log
foreach ($name in $tests.Keys) {
  if ($One -and $Case -and $name -ne $Case) { continue }
  $xmlPath = Join-Path $Root ($name + ".xml")
  $tests[$name] | Set-Content -Encoding UTF8 $xmlPath
  try {
    Show-ToastXml -Name $name -Xml $tests[$name]
    "OK $name" | Write-Output
    "OK $name" | Add-Content -Encoding UTF8 -Path $log
  } catch {
    $message = "FAIL $name $($_.Exception.GetType().FullName): $($_.Exception.Message)"
    $message | Write-Output
    $message | Add-Content -Encoding UTF8 -Path $log
  }
  if (-not $One) { Start-Sleep -Milliseconds $DelayMs }
}
