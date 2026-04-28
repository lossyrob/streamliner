[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SshTarget,
    [string]$RemoteWorktreePath = "",
    [string]$RemoteProbeRelativePath = ".streamliner\workstreams\devbox-support\tasks\devbox-access-probe.ps1",
    [int]$MaxSessions = 5,
    [string]$LocalBridgeUrl = "",
    [int]$ConnectTimeoutSec = 10
)

$ErrorActionPreference = "Stop"

function Add-ProbeError {
    param(
        [System.Collections.Generic.List[object]]$ErrorList,
        [string]$Scope,
        [string]$Message
    )

    $ErrorList.Add([ordered]@{
        scope = $Scope
        message = $Message
    }) | Out-Null
}

function ConvertTo-PowerShellLiteral {
    param([string]$Value)

    return "'" + $Value.Replace("'", "''") + "'"
}

function New-EncodedPowerShellCommand {
    param([string]$Script)

    return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Script))
}

function Invoke-SshCommand {
    param(
        [string]$Target,
        [string]$RemoteCommand,
        [int]$TimeoutSec,
        [string]$Name
    )

    $result = [ordered]@{
        name = $Name
        exitCode = $null
        succeeded = $false
        outputLines = @()
        error = $null
    }

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        Get-Command ssh -ErrorAction Stop | Out-Null
        $sshArgs = @(
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=$TimeoutSec",
            $Target,
            $RemoteCommand
        )
        $ErrorActionPreference = "Continue"
        $output = & ssh @sshArgs 2>&1
        $result.exitCode = $LASTEXITCODE
        $result.succeeded = $LASTEXITCODE -eq 0
        $result.outputLines = @($output | ForEach-Object { [string]$_ })
    } catch {
        $result.error = $_.Exception.Message
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    return $result
}

function Join-OutputLines {
    param([object[]]$Lines)

    return ($Lines | ForEach-Object { [string]$_ }) -join "`n"
}

function ConvertFrom-JsonOrNull {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }

    try {
        return $Text | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return $null
    }
}

function Summarize-RemoteProbe {
    param([object]$Probe)

    if ($null -eq $Probe) {
        return $null
    }

    $sessions = @($Probe.sessions)
    $eventTypes = @(
        $sessions |
            ForEach-Object { @($_.events.eventTypes) } |
            Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
            Sort-Object -Unique
    )
    $processStates = @(
        $sessions |
            ForEach-Object { $_.locks.processState } |
            Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
            Sort-Object -Unique
    )
    $sessionsWithHooks = @(
        $sessions |
            Where-Object { $_.events.hasHookEvents -eq $true }
    ).Count

    return [ordered]@{
        generatedAt = $Probe.generatedAt
        sessionStateRootExists = $Probe.checks.sessionStateRootExists
        sampledSessionCount = $sessions.Count
        sessionsWithWorkspace = @($sessions | Where-Object { $_.workspace.exists -eq $true }).Count
        sessionsWithEvents = @($sessions | Where-Object { $_.events.exists -eq $true }).Count
        sessionsWithHookEvents = $sessionsWithHooks
        eventTypes = $eventTypes
        processStates = $processStates
        errorCount = @($Probe.errors).Count
    }
}

$probeErrors = New-Object 'System.Collections.Generic.List[object]'

$hostScript = @'
$result = [ordered]@{
    computerNamePresent = -not [string]::IsNullOrWhiteSpace($env:COMPUTERNAME)
    userProfilePresent = -not [string]::IsNullOrWhiteSpace($env:USERPROFILE)
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    sessionStateRootExists = Test-Path -LiteralPath (Join-Path $env:USERPROFILE ".copilot\session-state")
    pathConventions = "windows"
}
$result | ConvertTo-Json -Compress
'@
$hostCommand = "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $(New-EncodedPowerShellCommand -Script $hostScript)"
$hostResult = Invoke-SshCommand -Target $SshTarget -RemoteCommand $hostCommand -TimeoutSec $ConnectTimeoutSec -Name "host-summary"
$hostSummary = ConvertFrom-JsonOrNull -Text (Join-OutputLines -Lines $hostResult.outputLines)
if ($hostResult.succeeded -and $null -eq $hostSummary) {
    Add-ProbeError -ErrorList $probeErrors -Scope "ssh.host-summary.parse" -Message "SSH host summary succeeded but did not return parseable JSON."
}

$remoteProbeResult = $null
$remoteProbeSummary = $null
$remoteProbeSkippedReason = $null
if (-not [string]::IsNullOrWhiteSpace($RemoteWorktreePath)) {
    if (-not $hostResult.succeeded) {
        $remoteProbeSkippedReason = "host-summary-failed"
    } else {
        $remoteWorktreeLiteral = ConvertTo-PowerShellLiteral -Value $RemoteWorktreePath
        $remoteProbeRelativeLiteral = ConvertTo-PowerShellLiteral -Value $RemoteProbeRelativePath
        $remoteProbeScript = @"
`$probePath = Join-Path $remoteWorktreeLiteral $remoteProbeRelativeLiteral
if (-not (Test-Path -LiteralPath `$probePath)) {
    throw "Remote probe path does not exist: `$probePath"
}
& `$probePath -MaxSessions $MaxSessions
"@
        $remoteProbeCommand = "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $(New-EncodedPowerShellCommand -Script $remoteProbeScript)"
        $remoteProbeResult = Invoke-SshCommand -Target $SshTarget -RemoteCommand $remoteProbeCommand -TimeoutSec $ConnectTimeoutSec -Name "remote-devbox-probe"
        $remoteProbe = ConvertFrom-JsonOrNull -Text (Join-OutputLines -Lines $remoteProbeResult.outputLines)
        $remoteProbeSummary = Summarize-RemoteProbe -Probe $remoteProbe
        if ($remoteProbeResult.succeeded -and $null -eq $remoteProbeSummary) {
            Add-ProbeError -ErrorList $probeErrors -Scope "ssh.remote-probe.parse" -Message "Remote devbox probe succeeded but did not return parseable JSON."
        }
    }
}

$localBridgeHealth = $null
if (-not [string]::IsNullOrWhiteSpace($LocalBridgeUrl)) {
    try {
        $localBridgeHealth = Invoke-RestMethod -Uri ($LocalBridgeUrl.TrimEnd("/") + "/health") -TimeoutSec 2
    } catch {
        Add-ProbeError -ErrorList $probeErrors -Scope "localBridge.health" -Message $_.Exception.Message
    }
}

$result = [ordered]@{
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    inputs = [ordered]@{
        sshTargetProvided = -not [string]::IsNullOrWhiteSpace($SshTarget)
        remoteWorktreePathProvided = -not [string]::IsNullOrWhiteSpace($RemoteWorktreePath)
        remoteProbeRelativePath = $RemoteProbeRelativePath
        maxSessions = $MaxSessions
        localBridgeUrlProvided = -not [string]::IsNullOrWhiteSpace($LocalBridgeUrl)
        connectTimeoutSec = $ConnectTimeoutSec
    }
    ssh = [ordered]@{
        hostSummaryExitCode = $hostResult.exitCode
        hostSummarySucceeded = $hostResult.succeeded
        hostSummary = $hostSummary
        hostSummaryError = $hostResult.error
        hostSummaryOutputLineCount = @($hostResult.outputLines).Count
    }
    remoteProbe = [ordered]@{
        attempted = $null -ne $remoteProbeResult
        exitCode = if ($remoteProbeResult) { $remoteProbeResult.exitCode } else { $null }
        succeeded = if ($remoteProbeResult) { $remoteProbeResult.succeeded } else { $false }
        summary = $remoteProbeSummary
        error = if ($remoteProbeResult) { $remoteProbeResult.error } else { $null }
        outputLineCount = if ($remoteProbeResult) { @($remoteProbeResult.outputLines).Count } else { 0 }
        skippedReason = $remoteProbeSkippedReason
    }
    localBridge = [ordered]@{
        attempted = -not [string]::IsNullOrWhiteSpace($LocalBridgeUrl)
        health = $localBridgeHealth
    }
    errors = @($probeErrors.ToArray())
}

$result | ConvertTo-Json -Depth 10
