[CmdletBinding()]
param(
    [string]$BridgeUrl = "http://127.0.0.1:17620",
    [int]$MaxSessions = 5,
    [int]$TailBytes = 8192,
    [string]$SyntheticSessionId = "issue22-transport-smoke",
    [int]$TimeoutSec = 10
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

function Invoke-JsonGet {
    param([string]$Url)

    return Invoke-RestMethod -Method Get -Uri $Url -TimeoutSec $TimeoutSec
}

function Invoke-JsonPost {
    param(
        [string]$Url,
        [object]$Body
    )

    $json = $Body | ConvertTo-Json -Depth 8
    return Invoke-RestMethod -Method Post -Uri $Url -Body $json -ContentType "application/json" -TimeoutSec $TimeoutSec
}

function Get-FirstTailCandidate {
    param([object]$Snapshot)

    foreach ($session in @($Snapshot.sessions)) {
        if ($session.events.exists -eq $true -and [int64]$session.events.sizeBytes -gt 0) {
            return $session
        }
    }

    return $null
}

$bridgeBase = $BridgeUrl.TrimEnd("/")
$probeErrors = New-Object 'System.Collections.Generic.List[object]'

$health = $null
$capabilities = $null
$snapshot = $null
$eventTail = $null
$postSignal = $null
$signals = $null

try {
    $health = Invoke-JsonGet -Url "$bridgeBase/health"
} catch {
    Add-ProbeError -ErrorList $probeErrors -Scope "health" -Message $_.Exception.Message
}

try {
    $capabilities = Invoke-JsonGet -Url "$bridgeBase/capabilities"
} catch {
    Add-ProbeError -ErrorList $probeErrors -Scope "capabilities" -Message $_.Exception.Message
}

try {
    $snapshot = Invoke-JsonGet -Url "$bridgeBase/sessions/snapshot?limit=$MaxSessions"
} catch {
    Add-ProbeError -ErrorList $probeErrors -Scope "snapshot" -Message $_.Exception.Message
}

$tailCandidate = $null
$tailAfterOffset = $null
if ($snapshot) {
    $tailCandidate = Get-FirstTailCandidate -Snapshot $snapshot
}

if ($tailCandidate) {
    $sizeBytes = [int64]$tailCandidate.events.sizeBytes
    $tailAfterOffset = [Math]::Max([int64]0, $sizeBytes - [int64]$TailBytes)
    $encodedSessionId = [Uri]::EscapeDataString([string]$tailCandidate.copilotSessionId)
    try {
        $eventTail = Invoke-JsonGet -Url "$bridgeBase/sessions/$encodedSessionId/events?afterOffset=$tailAfterOffset&maxBytes=$TailBytes"
    } catch {
        Add-ProbeError -ErrorList $probeErrors -Scope "event-tail" -Message $_.Exception.Message
    }
}

$syntheticSignal = [ordered]@{
    signalId = "issue22-probe-$([Guid]::NewGuid().ToString("N"))"
    type = "session.started"
    source = "issue22-transport-probe"
    sessionId = $SyntheticSessionId
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    cwd = ""
    promptLength = 0
}

try {
    $postSignal = Invoke-JsonPost -Url "$bridgeBase/api/sessions/signals" -Body $syntheticSignal
} catch {
    Add-ProbeError -ErrorList $probeErrors -Scope "signal-post" -Message $_.Exception.Message
}

try {
    $signals = Invoke-JsonGet -Url "$bridgeBase/signals?after=0&limit=20"
} catch {
    Add-ProbeError -ErrorList $probeErrors -Scope "signal-read" -Message $_.Exception.Message
}

$signalFound = $false
if ($signals) {
    foreach ($signal in @($signals.signals)) {
        if ([string]$signal.signalId -eq [string]$syntheticSignal.signalId) {
            $signalFound = $true
        }
    }
}

$sampledSessions = @()
if ($snapshot) {
    $sampledSessions = @($snapshot.sessions)
}

$eventTypes = @(
    $sampledSessions |
        ForEach-Object { @($_.events.eventTypes) } |
        Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
        Sort-Object -Unique
)

$processStates = @(
    $sampledSessions |
        ForEach-Object { $_.locks.processState } |
        Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
        Sort-Object -Unique
)

$healthStatus = $null
$healthBridgeVersion = $null
$healthLoopbackOnly = $null
$healthSessionStateRootExists = $null
$healthPathConventions = $null
$healthSignalSpoolCount = $null
if ($health) {
    $healthStatus = $health.status
    $healthBridgeVersion = $health.bridgeVersion
    $healthLoopbackOnly = $health.loopbackOnly
    $healthSessionStateRootExists = $health.sessionStateRootExists
    $healthPathConventions = $health.pathConventions
    $healthSignalSpoolCount = $health.signalSpoolCount
}

$capabilitySummary = $null
if ($capabilities) {
    $capabilitySummary = $capabilities.capabilities
}

$tailSessionId = $null
if ($tailCandidate) {
    $tailSessionId = $tailCandidate.copilotSessionId
}

$tailNextOffset = $null
$tailEventCount = 0
$tailRawContentOmitted = $null
$tailParseErrors = $null
if ($eventTail) {
    $tailNextOffset = $eventTail.nextOffset
    $tailEvents = @($eventTail.events)
    $tailEventCount = $tailEvents.Count
    if ($tailEvents.Count -gt 0) {
        $tailRawContentOmitted = $tailEvents[0].rawContentOmitted
    }
    $tailParseErrors = $eventTail.parseErrors
}

$acceptedSignalId = $null
if ($postSignal) {
    $acceptedSignalId = $postSignal.signalId
}

$readSignalCount = 0
if ($signals) {
    $readSignalCount = @($signals.signals).Count
}

$result = [ordered]@{
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    bridgeUrlProvided = -not [string]::IsNullOrWhiteSpace($BridgeUrl)
    checks = [ordered]@{
        healthSucceeded = $null -ne $health -and [string]$health.status -eq "ok"
        capabilitiesSucceeded = $null -ne $capabilities
        snapshotSucceeded = $null -ne $snapshot
        eventTailAttempted = $null -ne $tailCandidate
        eventTailSucceeded = $null -ne $eventTail
        signalPostSucceeded = $null -ne $postSignal -and [string]$postSignal.status -eq "accepted"
        signalReadSucceeded = $null -ne $signals
        signalReadContainsSynthetic = $signalFound
    }
    health = [ordered]@{
        status = $healthStatus
        bridgeVersion = $healthBridgeVersion
        loopbackOnly = $healthLoopbackOnly
        sessionStateRootExists = $healthSessionStateRootExists
        pathConventions = $healthPathConventions
        signalSpoolCount = $healthSignalSpoolCount
    }
    capabilities = $capabilitySummary
    snapshotSummary = [ordered]@{
        sampledSessionCount = $sampledSessions.Count
        sessionsWithEvents = @($sampledSessions | Where-Object { $_.events.exists -eq $true }).Count
        sessionsWithTrustedHookEvents = @($sampledSessions | Where-Object { $_.trustedSignals.admitted -eq $true }).Count
        eventTypes = $eventTypes
        processStates = $processStates
    }
    eventTailSummary = [ordered]@{
        copilotSessionId = $tailSessionId
        fromOffset = $tailAfterOffset
        nextOffset = $tailNextOffset
        eventCount = $tailEventCount
        rawContentOmitted = $tailRawContentOmitted
        parseErrors = $tailParseErrors
    }
    signalSummary = [ordered]@{
        postedSignalId = $syntheticSignal.signalId
        acceptedSignalId = $acceptedSignalId
        readSignalCount = $readSignalCount
        containsSyntheticSignal = $signalFound
    }
    errors = @($probeErrors.ToArray())
}

$result | ConvertTo-Json -Depth 12
