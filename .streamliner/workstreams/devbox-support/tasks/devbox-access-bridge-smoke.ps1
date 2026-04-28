[CmdletBinding()]
param(
    [int]$Port = 17619,
    [int]$MaxSessions = 5
)

$ErrorActionPreference = "Stop"

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

function New-HealthResponse {
    $sessionStateRoot = Join-Path $env:USERPROFILE ".copilot\session-state"
    $body = [ordered]@{
        schemaVersion = 1
        kind = "devbox-access-bridge-smoke"
        status = "ok"
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        loopbackOnly = $true
        sessionStateRootExists = Test-Path -LiteralPath $sessionStateRoot
    }

    return $body | ConvertTo-Json -Depth 5
}

function New-SnapshotResponse {
    $probePath = Join-Path $PSScriptRoot "devbox-access-probe.ps1"
    if (-not (Test-Path -LiteralPath $probePath)) {
        throw "Probe script not found: $probePath"
    }

    return (& $probePath -MaxSessions $MaxSessions) -join [Environment]::NewLine
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

Write-Host "Devbox access smoke bridge listening on http://127.0.0.1:$Port/"
Write-Host "Endpoints: /health, /snapshot"
Write-Host "Press Ctrl+C to stop."

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()

            do {
                $headerLine = $reader.ReadLine()
            } while ($null -ne $headerLine -and $headerLine -ne "")

            $path = "/"
            if ($requestLine -match "^[A-Z]+\s+(\S+)") {
                $path = $matches[1].Split("?")[0]
            }

            if ($path -eq "/health") {
                Send-HttpResponse -Stream $stream -StatusCode 200 -Reason "OK" -Body (New-HealthResponse)
            } elseif ($path -eq "/snapshot") {
                Send-HttpResponse -Stream $stream -StatusCode 200 -Reason "OK" -Body (New-SnapshotResponse)
            } else {
                $notFound = [ordered]@{
                    schemaVersion = 1
                    status = "not_found"
                    path = $path
                } | ConvertTo-Json -Depth 3
                Send-HttpResponse -Stream $stream -StatusCode 404 -Reason "Not Found" -Body $notFound
            }
        } catch {
            try {
                $errorBody = [ordered]@{
                    schemaVersion = 1
                    status = "error"
                    message = $_.Exception.Message
                } | ConvertTo-Json -Depth 3
                Send-HttpResponse -Stream $stream -StatusCode 500 -Reason "Internal Server Error" -Body $errorBody
            } catch {
                # Ignore secondary write failures while closing the client.
            }
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
