[CmdletBinding()]
param(
    [string]$SessionStateRoot = (Join-Path $env:USERPROFILE ".copilot\session-state"),
    [int]$MaxSessions = 8,
    [string]$BridgeUrl = ""
)

$ErrorActionPreference = "Stop"

function Add-Error {
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

function Read-WorkspaceFields {
    param([string]$Path)

    $fields = [ordered]@{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $fields
    }

    foreach ($line in Get-Content -LiteralPath $Path -TotalCount 200) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)\s*$') {
            $key = $Matches[1]
            $value = $Matches[2].Trim()
            if (
                ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))
            ) {
                $value = $value.Substring(1, [Math]::Max(0, $value.Length - 2))
            }
            $fields[$key] = $value
        }
    }

    return $fields
}

function Get-WorkspaceValue {
    param(
        [System.Collections.Specialized.OrderedDictionary]$Fields,
        [string]$Key
    )

    if ($Fields.Contains($Key)) {
        return $Fields[$Key]
    }

    return $null
}

function Read-EventShape {
    param(
        [string]$Path,
        [System.Collections.Generic.List[object]]$ErrorList
    )

    $shape = [pscustomobject]@{
        exists = $false
        sizeBytes = 0
        lastWriteTimeUtc = $null
        parsedTailEvents = 0
        parseErrors = 0
        eventTypes = @()
        latestEventType = $null
        latestEventTimestamp = $null
        hasHookEvents = $false
        hasAssistantTurnEnd = $false
        hasUserMessage = $false
        hasToolExecution = $false
    }

    if (-not (Test-Path -LiteralPath $Path)) {
        return $shape
    }

    $item = Get-Item -LiteralPath $Path
    $shape.exists = $true
    $shape.sizeBytes = $item.Length
    $shape.lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString("o")

    $eventTypes = New-Object 'System.Collections.Generic.HashSet[string]'
    try {
        foreach ($line in Get-Content -LiteralPath $Path -Tail 200) {
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }

            try {
                $event = $line | ConvertFrom-Json -ErrorAction Stop
            } catch {
                $shape.parseErrors += 1
                continue
            }

            $type = [string]$event.type
            if ([string]::IsNullOrWhiteSpace($type)) {
                continue
            }

            $shape.parsedTailEvents += 1
            [void]$eventTypes.Add($type)
            $shape.latestEventType = $type
            if ($event.timestamp) {
                $shape.latestEventTimestamp = [string]$event.timestamp
            }
            if ($type -eq "hook.start" -or $type -eq "hook.end") {
                $shape.hasHookEvents = $true
            }
            if ($type -eq "assistant.turn_end") {
                $shape.hasAssistantTurnEnd = $true
            }
            if ($type -eq "user.message") {
                $shape.hasUserMessage = $true
            }
            if ($type -eq "tool.execution_start" -or $type -eq "tool.execution_complete") {
                $shape.hasToolExecution = $true
            }
        }
    } catch {
        Add-Error -ErrorList $ErrorList -Scope $Path -Message $_.Exception.Message
    }

    $shape.eventTypes = @($eventTypes.GetEnumerator() | Sort-Object)
    return $shape
}

function Read-LockShape {
    param([string]$SessionDir)

    $lockFiles = @(Get-ChildItem -LiteralPath $SessionDir -File -Filter "inuse.*.lock" -ErrorAction SilentlyContinue)
    $lockPids = @()
    foreach ($lockFile in $lockFiles) {
        if ($lockFile.Name -match '^inuse\.(\d+)\.lock$') {
            $lockPids += [int]$Matches[1]
        }
    }

    $livePids = @()
    foreach ($lockPid in ($lockPids | Sort-Object -Unique)) {
        try {
            Get-Process -Id $lockPid -ErrorAction Stop | Out-Null
            $livePids += $lockPid
        } catch {
            # A missing process is the expected stale-lock signal.
        }
    }

    $processState = "none"
    if ($livePids.Count -gt 0) {
        $processState = "live"
    } elseif ($lockPids.Count -gt 0) {
        $processState = "stale_lock"
    }

    return [ordered]@{
        lockFiles = @($lockFiles | ForEach-Object { $_.Name })
        lockPids = @($lockPids | Sort-Object -Unique)
        livePids = @($livePids | Sort-Object -Unique)
        processState = $processState
    }
}

$probeErrors = New-Object 'System.Collections.Generic.List[object]'
$os = $null
try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem
} catch {
    Add-Error -ErrorList $probeErrors -Scope "host.os" -Message $_.Exception.Message
}

$bridgeHealth = $null
if (-not [string]::IsNullOrWhiteSpace($BridgeUrl)) {
    try {
        $bridgeHealth = Invoke-RestMethod -Uri ($BridgeUrl.TrimEnd("/") + "/health") -TimeoutSec 2
    } catch {
        Add-Error -ErrorList $probeErrors -Scope "bridge.health" -Message $_.Exception.Message
    }
}

$sessionRootExists = Test-Path -LiteralPath $SessionStateRoot
$sessionRootItem = $null
if ($sessionRootExists) {
    try {
        $sessionRootItem = Get-Item -LiteralPath $SessionStateRoot
    } catch {
        Add-Error -ErrorList $probeErrors -Scope "sessionStateRoot" -Message $_.Exception.Message
    }
}

$sessions = @()
if ($sessionRootExists) {
    try {
        $sessionDirs = Get-ChildItem -LiteralPath $SessionStateRoot -Directory -ErrorAction Stop |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First $MaxSessions

        foreach ($sessionDir in $sessionDirs) {
            $workspacePath = Join-Path $sessionDir.FullName "workspace.yaml"
            $eventsPath = Join-Path $sessionDir.FullName "events.jsonl"
            $workspace = Read-WorkspaceFields -Path $workspacePath
            $workspaceItem = if (Test-Path -LiteralPath $workspacePath) { Get-Item -LiteralPath $workspacePath } else { $null }

            $summary = [string](Get-WorkspaceValue -Fields $workspace -Key "summary")
            $workspaceLastWriteTimeUtc = $null
            if ($workspaceItem) {
                $workspaceLastWriteTimeUtc = $workspaceItem.LastWriteTimeUtc.ToString("o")
            }
            $sessions += [ordered]@{
                dirName = $sessionDir.Name
                dirLastWriteTimeUtc = $sessionDir.LastWriteTimeUtc.ToString("o")
                workspace = [ordered]@{
                    exists = $null -ne $workspaceItem
                    lastWriteTimeUtc = $workspaceLastWriteTimeUtc
                    id = Get-WorkspaceValue -Fields $workspace -Key "id"
                    cwd = Get-WorkspaceValue -Fields $workspace -Key "cwd"
                    repository = Get-WorkspaceValue -Fields $workspace -Key "repository"
                    branch = Get-WorkspaceValue -Fields $workspace -Key "branch"
                    createdAt = Get-WorkspaceValue -Fields $workspace -Key "created_at"
                    updatedAt = Get-WorkspaceValue -Fields $workspace -Key "updated_at"
                    summaryPresent = -not [string]::IsNullOrWhiteSpace($summary)
                    summaryLength = $summary.Length
                }
                locks = Read-LockShape -SessionDir $sessionDir.FullName
                events = Read-EventShape -Path $eventsPath -ErrorList $probeErrors
            }
        }
    } catch {
        Add-Error -ErrorList $probeErrors -Scope "sessions.enumerate" -Message $_.Exception.Message
    }
}

$osCaption = $null
$osVersion = $null
if ($os) {
    $osCaption = $os.Caption
    $osVersion = $os.Version
}

$sessionRootLastWriteTimeUtc = $null
if ($sessionRootItem) {
    $sessionRootLastWriteTimeUtc = $sessionRootItem.LastWriteTimeUtc.ToString("o")
}

$result = [ordered]@{
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    host = [ordered]@{
        computerName = $env:COMPUTERNAME
        userName = $env:USERNAME
        userProfile = $env:USERPROFILE
        osCaption = $osCaption
        osVersion = $osVersion
        powershellVersion = $PSVersionTable.PSVersion.ToString()
    }
    inputs = [ordered]@{
        sessionStateRoot = $SessionStateRoot
        maxSessions = $MaxSessions
        bridgeUrlProvided = -not [string]::IsNullOrWhiteSpace($BridgeUrl)
    }
    checks = [ordered]@{
        sessionStateRootExists = $sessionRootExists
        sessionStateRootLastWriteTimeUtc = $sessionRootLastWriteTimeUtc
        bridgeHealth = $bridgeHealth
    }
    sessions = $sessions
    errors = @($probeErrors.ToArray())
}

$result | ConvertTo-Json -Depth 10
