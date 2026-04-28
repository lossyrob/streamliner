[CmdletBinding()]
param(
    [int]$Port = 17620,
    [string]$SessionStateRoot = (Join-Path $env:USERPROFILE ".copilot\session-state"),
    [int]$MaxSessions = 8
)

$ErrorActionPreference = "Stop"
$script:Signals = New-Object 'System.Collections.Generic.List[object]'
$script:NextSignalCursor = 1

function Send-HttpResponse {
    param(
        [System.IO.Stream]$Stream,
        [int]$StatusCode,
        [string]$Reason,
        [string]$Body,
        [string]$ContentType = "application/json"
    )

    $bodyBytes = [Text.Encoding]::UTF8.GetBytes($Body)
    $headers = @(
        "HTTP/1.1 $StatusCode $Reason",
        "Content-Type: $ContentType; charset=utf-8",
        "Content-Length: $($bodyBytes.Length)",
        "Connection: close",
        "",
        ""
    ) -join "`r`n"
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)

    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    $Stream.Write($bodyBytes, 0, $bodyBytes.Length)
}

function ConvertTo-JsonBody {
    param([object]$Value)

    return $Value | ConvertTo-Json -Depth 12
}

function New-JsonResponse {
    param(
        [int]$StatusCode,
        [string]$Reason,
        [object]$Body
    )

    return [ordered]@{
        statusCode = $StatusCode
        reason = $Reason
        body = ConvertTo-JsonBody -Value $Body
    }
}

function Read-HttpRequest {
    param([System.Net.Sockets.TcpClient]$Client)

    $stream = $Client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::UTF8, $false, 4096, $true)
    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) {
        throw "Empty request line."
    }

    $headers = @{}
    do {
        $headerLine = $reader.ReadLine()
        if ($null -ne $headerLine -and $headerLine -ne "") {
            $separator = $headerLine.IndexOf(":")
            if ($separator -gt 0) {
                $name = $headerLine.Substring(0, $separator).Trim().ToLowerInvariant()
                $value = $headerLine.Substring($separator + 1).Trim()
                $headers[$name] = $value
            }
        }
    } while ($null -ne $headerLine -and $headerLine -ne "")

    $body = ""
    $contentLength = 0
    if ($headers.ContainsKey("content-length")) {
        [int]::TryParse([string]$headers["content-length"], [ref]$contentLength) | Out-Null
    }
    if ($contentLength -gt 0) {
        $buffer = New-Object char[] $contentLength
        $read = $reader.ReadBlock($buffer, 0, $contentLength)
        $body = -join $buffer[0..([Math]::Max(0, $read - 1))]
    }

    if ($requestLine -notmatch "^([A-Z]+)\s+(\S+)\s+HTTP/") {
        throw "Unsupported request line: $requestLine"
    }

    $target = $Matches[2]
    $path = $target
    $query = ""
    $queryIndex = $target.IndexOf("?")
    if ($queryIndex -ge 0) {
        $path = $target.Substring(0, $queryIndex)
        $query = $target.Substring($queryIndex + 1)
    }

    return [ordered]@{
        method = $Matches[1]
        target = $target
        path = $path
        query = $query
        body = $body
        stream = $stream
    }
}

function Get-QueryValue {
    param(
        [string]$Query,
        [string]$Name,
        [string]$Default = ""
    )

    foreach ($part in ($Query -split "&")) {
        if ([string]::IsNullOrWhiteSpace($part)) {
            continue
        }
        $separator = $part.IndexOf("=")
        if ($separator -lt 0) {
            continue
        }
        $key = [Uri]::UnescapeDataString($part.Substring(0, $separator))
        if ($key -eq $Name) {
            return [Uri]::UnescapeDataString($part.Substring($separator + 1))
        }
    }

    return $Default
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
        }
    }

    $processState = "none"
    if ($livePids.Count -gt 0) {
        $processState = "live"
    } elseif ($lockPids.Count -gt 0) {
        $processState = "stale_lock"
    }

    return [ordered]@{
        processState = $processState
        lockCount = $lockFiles.Count
    }
}

function Read-EventShape {
    param([string]$Path)

    $shape = [ordered]@{
        exists = $false
        sizeBytes = 0
        lastWriteTimeUtc = $null
        nextOffset = 0
        parsedTailEvents = 0
        parseErrors = 0
        eventTypes = @()
        latestEventType = $null
        latestEventTimestamp = $null
        hasHookEvents = $false
    }

    if (-not (Test-Path -LiteralPath $Path)) {
        return $shape
    }

    $item = Get-Item -LiteralPath $Path
    $shape.exists = $true
    $shape.sizeBytes = $item.Length
    $shape.nextOffset = $item.Length
    $shape.lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString("o")
    $eventTypes = New-Object 'System.Collections.Generic.HashSet[string]'

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
        if ($type.StartsWith("hook.")) {
            $shape.hasHookEvents = $true
        }
    }

    $shape.eventTypes = @($eventTypes.GetEnumerator() | Sort-Object)
    return $shape
}

function Get-PathConventions {
    if ($IsWindows -or $env:OS -eq "Windows_NT") {
        return "windows"
    }

    return "posix"
}

function Get-RecentSessions {
    param([int]$Limit)

    if (-not (Test-Path -LiteralPath $SessionStateRoot)) {
        return @()
    }

    $sessions = @()
    $sessionDirs = Get-ChildItem -LiteralPath $SessionStateRoot -Directory -ErrorAction Stop |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First $Limit

    foreach ($sessionDir in $sessionDirs) {
        $workspacePath = Join-Path $sessionDir.FullName "workspace.yaml"
        $eventsPath = Join-Path $sessionDir.FullName "events.jsonl"
        $workspace = Read-WorkspaceFields -Path $workspacePath
        $summary = [string](Get-WorkspaceValue -Fields $workspace -Key "summary")
        $events = Read-EventShape -Path $eventsPath

        $sessions += [ordered]@{
            copilotSessionId = $sessionDir.Name
            sessionDirName = $sessionDir.Name
            workspace = [ordered]@{
                cwd = Get-WorkspaceValue -Fields $workspace -Key "cwd"
                repository = Get-WorkspaceValue -Fields $workspace -Key "repository"
                branch = Get-WorkspaceValue -Fields $workspace -Key "branch"
                createdAt = Get-WorkspaceValue -Fields $workspace -Key "created_at"
                updatedAt = Get-WorkspaceValue -Fields $workspace -Key "updated_at"
                summaryPresent = -not [string]::IsNullOrWhiteSpace($summary)
                summaryLength = $summary.Length
            }
            events = $events
            locks = Read-LockShape -SessionDir $sessionDir.FullName
            trustedSignals = [ordered]@{
                admitted = $events.hasHookEvents
                latestSignalAt = $null
                latestSignalType = $null
            }
            diagnostics = @()
        }
    }

    return $sessions
}

function Find-SessionDir {
    param([string]$SessionId)

    if (-not (Test-Path -LiteralPath $SessionStateRoot)) {
        return $null
    }

    return Get-ChildItem -LiteralPath $SessionStateRoot -Directory -ErrorAction Stop |
        Where-Object { $_.Name -eq $SessionId } |
        Select-Object -First 1
}

function New-Health {
    $sessionStateRootExists = Test-Path -LiteralPath $SessionStateRoot
    return [ordered]@{
        schemaVersion = 1
        kind = "remote-observation-transport-bridge-smoke"
        status = "ok"
        bridgeVersion = "issue22-smoke-1"
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        loopbackOnly = $true
        pathConventions = Get-PathConventions
        sessionStateRoot = $SessionStateRoot
        sessionStateRootExists = $sessionStateRootExists
        signalSpoolCount = $script:Signals.Count
        diagnostics = @()
    }
}

function New-Capabilities {
    return [ordered]@{
        schemaVersion = 1
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        capabilities = [ordered]@{
            health = $true
            snapshots = $true
            eventTailByOffset = $true
            signalPost = $true
            signalCursorRead = $true
            processLockLiveness = $true
            rawContentOmitted = $true
        }
        limits = [ordered]@{
            maxSnapshotSessions = $MaxSessions
            maxEventTailBytes = 65536
        }
    }
}

function New-Snapshot {
    param([int]$Limit)

    return [ordered]@{
        schemaVersion = 1
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        environmentId = "issue22-smoke-devbox"
        pathConventions = Get-PathConventions
        sessionStateRoot = $SessionStateRoot
        sessions = @(Get-RecentSessions -Limit $Limit)
        diagnostics = @()
    }
}

function New-EventTail {
    param(
        [string]$SessionId,
        [long]$AfterOffset,
        [int]$MaxBytes
    )

    $sessionDir = Find-SessionDir -SessionId $SessionId
    if ($null -eq $sessionDir) {
        return New-JsonResponse -StatusCode 404 -Reason "Not Found" -Body ([ordered]@{
            schemaVersion = 1
            status = "not_found"
            copilotSessionId = $SessionId
            diagnostics = @("session_not_found")
        })
    }

    $eventsPath = Join-Path $sessionDir.FullName "events.jsonl"
    if (-not (Test-Path -LiteralPath $eventsPath)) {
        return New-JsonResponse -StatusCode 404 -Reason "Not Found" -Body ([ordered]@{
            schemaVersion = 1
            status = "not_found"
            copilotSessionId = $SessionId
            diagnostics = @("events_file_not_found")
        })
    }

    $file = Get-Item -LiteralPath $eventsPath
    if ($AfterOffset -lt 0 -or $AfterOffset -gt $file.Length) {
        return New-JsonResponse -StatusCode 409 -Reason "Conflict" -Body ([ordered]@{
            schemaVersion = 1
            status = "cursor_invalid"
            copilotSessionId = $SessionId
            fromOffset = $AfterOffset
            safeResyncOffset = 0
            currentSizeBytes = $file.Length
            diagnostics = @("cursor_invalid")
        })
    }

    $bytesToRead = [Math]::Min([int64]$MaxBytes, [int64]($file.Length - $AfterOffset))
    $events = @()
    $parseErrors = 0
    $nextOffset = $AfterOffset
    if ($bytesToRead -gt 0) {
        $stream = [System.IO.File]::Open($eventsPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $stream.Seek($AfterOffset, [System.IO.SeekOrigin]::Begin) | Out-Null
            $buffer = New-Object byte[] $bytesToRead
            $readBytes = $stream.Read($buffer, 0, $bytesToRead)
            $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $readBytes)
            $lineOffset = $AfterOffset
            $lines = @($text -split "`n")
            $startIndex = 0
            if ($AfterOffset -gt 0 -and $lines.Count -gt 0) {
                $lineOffset += [Text.Encoding]::UTF8.GetByteCount($lines[0] + "`n")
                $startIndex = 1
            }
            for ($lineIndex = $startIndex; $lineIndex -lt $lines.Count; $lineIndex += 1) {
                $line = $lines[$lineIndex]
                $trimmedLine = $line.TrimEnd("`r")
                if ([string]::IsNullOrWhiteSpace($trimmedLine)) {
                    $lineOffset += [Text.Encoding]::UTF8.GetByteCount($line + "`n")
                    continue
                }
                try {
                    $event = $trimmedLine | ConvertFrom-Json -ErrorAction Stop
                    $eventType = [string]$event.type
                    $timestamp = $null
                    if ($event.timestamp) {
                        $timestamp = [string]$event.timestamp
                    }
                    $toolName = $null
                    $toolCallId = $null
                    if ($event.toolName) {
                        $toolName = [string]$event.toolName
                    }
                    if ($event.toolCallId) {
                        $toolCallId = [string]$event.toolCallId
                    }
                    $lineBytes = [Text.Encoding]::UTF8.GetByteCount($line + "`n")
                    $events += [ordered]@{
                        offset = $lineOffset
                        byteLength = $lineBytes
                        type = $eventType
                        timestamp = $timestamp
                        toolCallId = $toolCallId
                        toolName = $toolName
                        promptLength = $null
                        rawContentOmitted = $true
                    }
                    $lineOffset += $lineBytes
                    $nextOffset = $lineOffset
                } catch {
                    $parseErrors += 1
                }
            }
            if ($events.Count -eq 0) {
                $nextOffset = $AfterOffset + $readBytes
            }
        } finally {
            $stream.Dispose()
        }
    }

    return New-JsonResponse -StatusCode 200 -Reason "OK" -Body ([ordered]@{
        schemaVersion = 1
        copilotSessionId = $SessionId
        fromOffset = $AfterOffset
        nextOffset = $nextOffset
        events = $events
        diagnostics = @()
        parseErrors = $parseErrors
    })
}

function Add-Signal {
    param([string]$Body)

    $payload = $null
    try {
        $payload = $Body | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return New-JsonResponse -StatusCode 400 -Reason "Bad Request" -Body ([ordered]@{
            schemaVersion = 1
            status = "invalid_json"
            diagnostics = @($_.Exception.Message)
        })
    }

    $signalType = $null
    if ($payload.type) {
        $signalType = [string]$payload.type
    } elseif ($payload.signalType) {
        $signalType = [string]$payload.signalType
    }
    $sessionId = [string]$payload.sessionId
    $signalId = [string]$payload.signalId
    if ([string]::IsNullOrWhiteSpace($signalId)) {
        $signalId = "issue22-smoke-$($script:NextSignalCursor)"
    }

    $record = [ordered]@{
        cursor = $script:NextSignalCursor
        signalId = $signalId
        receivedAt = (Get-Date).ToUniversalTime().ToString("o")
        signalType = $signalType
        sessionId = $sessionId
        timestamp = [string]$payload.timestamp
        source = [string]$payload.source
        rawContentOmitted = $true
    }
    $script:NextSignalCursor += 1
    $script:Signals.Add($record) | Out-Null

    return New-JsonResponse -StatusCode 202 -Reason "Accepted" -Body ([ordered]@{
        schemaVersion = 1
        status = "accepted"
        cursor = $record.cursor
        signalId = $record.signalId
    })
}

function Read-Signals {
    param(
        [long]$After,
        [int]$Limit
    )

    $items = @(
        $script:Signals |
            Where-Object { $_.cursor -gt $After } |
            Select-Object -First $Limit
    )
    $nextCursor = $After
    if ($items.Count -gt 0) {
        $nextCursor = $items[-1].cursor
    }

    return [ordered]@{
        schemaVersion = 1
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        fromCursor = $After
        nextCursor = $nextCursor
        signals = $items
        diagnostics = @()
    }
}

function Handle-Request {
    param([object]$Request)

    if ($Request.method -eq "GET" -and $Request.path -eq "/health") {
        return New-JsonResponse -StatusCode 200 -Reason "OK" -Body (New-Health)
    }
    if ($Request.method -eq "GET" -and $Request.path -eq "/capabilities") {
        return New-JsonResponse -StatusCode 200 -Reason "OK" -Body (New-Capabilities)
    }
    if ($Request.method -eq "GET" -and $Request.path -eq "/sessions/snapshot") {
        $limitText = Get-QueryValue -Query $Request.query -Name "limit" -Default ([string]$MaxSessions)
        $limit = $MaxSessions
        [int]::TryParse($limitText, [ref]$limit) | Out-Null
        return New-JsonResponse -StatusCode 200 -Reason "OK" -Body (New-Snapshot -Limit $limit)
    }
    if ($Request.method -eq "GET" -and $Request.path -match "^/sessions/([^/]+)/events$") {
        $sessionId = [Uri]::UnescapeDataString($Matches[1])
        $afterText = Get-QueryValue -Query $Request.query -Name "afterOffset" -Default "0"
        $maxBytesText = Get-QueryValue -Query $Request.query -Name "maxBytes" -Default "65536"
        $afterOffset = [int64]0
        $maxBytes = 65536
        [int64]::TryParse($afterText, [ref]$afterOffset) | Out-Null
        [int]::TryParse($maxBytesText, [ref]$maxBytes) | Out-Null
        return New-EventTail -SessionId $sessionId -AfterOffset $afterOffset -MaxBytes $maxBytes
    }
    if ($Request.method -eq "GET" -and $Request.path -eq "/signals") {
        $afterText = Get-QueryValue -Query $Request.query -Name "after" -Default "0"
        $limitText = Get-QueryValue -Query $Request.query -Name "limit" -Default "50"
        $after = [int64]0
        $limit = 50
        [int64]::TryParse($afterText, [ref]$after) | Out-Null
        [int]::TryParse($limitText, [ref]$limit) | Out-Null
        return New-JsonResponse -StatusCode 200 -Reason "OK" -Body (Read-Signals -After $after -Limit $limit)
    }
    if ($Request.method -eq "POST" -and $Request.path -eq "/api/sessions/signals") {
        return Add-Signal -Body $Request.body
    }

    return New-JsonResponse -StatusCode 404 -Reason "Not Found" -Body ([ordered]@{
        schemaVersion = 1
        status = "not_found"
        path = $Request.path
    })
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

Write-Host "Remote observation transport smoke bridge listening on http://127.0.0.1:$Port/"
Write-Host "Endpoints: /health, /capabilities, /sessions/snapshot, /sessions/{id}/events, /signals, POST /api/sessions/signals"
Write-Host "Session state root: $SessionStateRoot"
Write-Host "Press Ctrl+C to stop."

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $request = Read-HttpRequest -Client $client
            $response = Handle-Request -Request $request
            Send-HttpResponse -Stream $request.stream -StatusCode $response.statusCode -Reason $response.reason -Body $response.body
        } catch {
            try {
                $errorBody = [ordered]@{
                    schemaVersion = 1
                    status = "error"
                    message = $_.Exception.Message
                } | ConvertTo-Json -Depth 3
                Send-HttpResponse -Stream $client.GetStream() -StatusCode 500 -Reason "Internal Server Error" -Body $errorBody
            } catch {
            }
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
