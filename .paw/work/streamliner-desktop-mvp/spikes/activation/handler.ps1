param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $dir 'activation-log.ndjson'
$txt = Join-Path $dir 'activation-log.txt'
$entry = [ordered]@{
  timestamp = (Get-Date).ToString('o')
  pid = $PID
  argv = @($Args)
  commandLine = [Environment]::CommandLine
}
$json = $entry | ConvertTo-Json -Compress -Depth 5
Add-Content -LiteralPath $log -Value $json -Encoding utf8
Add-Content -LiteralPath $txt -Value ("{0}`tPID={1}`tARGS={2}`tCMD={3}" -f $entry.timestamp,$PID,($Args -join ' | '),[Environment]::CommandLine) -Encoding utf8
