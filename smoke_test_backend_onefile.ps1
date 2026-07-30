param(
    [string]$ExePath = ".\\dist\\RadioTEDU-OnAir-Backend.exe",
    [string]$BaseUrl = "http://127.0.0.1:8100",
    [int]$StartTimeoutSec = 25,
    [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"
$BackendProcessName = "RadioTEDU-OnAir-Backend"
$LegacyBackendProcessName = "cleanroom-radio-backend"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$exeCandidate = $ExePath
if (-not [System.IO.Path]::IsPathRooted($ExePath)) {
    $exeCandidate = Join-Path $root $ExePath
}
if (-not (Test-Path $exeCandidate)) {
    $lastPathFile = Join-Path $root "last_build_path.txt"
    if (Test-Path $lastPathFile) {
        $lastBuiltExe = (Get-Content -Path $lastPathFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
        if ($lastBuiltExe -and (Test-Path $lastBuiltExe)) {
            Write-Warning "Default EXE not found. Using last build path from $lastPathFile"
            $exeCandidate = $lastBuiltExe
        }
    }
}

if (-not (Test-Path $exeCandidate)) {
    $candidates = Get-ChildItem -Path $root -Directory -Filter "dist*" -ErrorAction SilentlyContinue `
        | Sort-Object LastWriteTime -Descending `
        | ForEach-Object { Join-Path $_.FullName "RadioTEDU-OnAir-Backend.exe" } `
        | Where-Object { Test-Path $_ }
    if ($candidates -and @($candidates).Count -gt 0) {
        $exeCandidate = @($candidates)[0]
        Write-Warning "Default EXE not found. Using most recent build: $exeCandidate"
    }
}

if (-not (Test-Path $exeCandidate)) {
    throw "Executable not found: $exeCandidate (and no fallback dist executable found)"
}

$exeFull = [System.IO.Path]::GetFullPath((Resolve-Path $exeCandidate))
$exeDir = Split-Path -Parent $exeFull
$endpointFailures = @()

# Stop any running backend process to avoid port collisions and false-positive checks.
$running = @(
    Get-Process -Name $BackendProcessName -ErrorAction SilentlyContinue
    Get-Process -Name $LegacyBackendProcessName -ErrorAction SilentlyContinue
)
if ($running) {
    $running | ForEach-Object {
        Write-Output "Stopping prior process PID=$($_.Id) ($($_.Path))"
        Stop-Process -Id $_.Id -Force
    }
    Start-Sleep -Milliseconds 500
}

Write-Output "Starting $exeFull"
$previousOpenPanel = [Environment]::GetEnvironmentVariable("CLEANROOM_OPEN_PANEL", "Process")
[Environment]::SetEnvironmentVariable("CLEANROOM_OPEN_PANEL", "0", "Process")
try {
    $started = Start-Process -FilePath $exeFull -WorkingDirectory $exeDir -PassThru
}
finally {
    [Environment]::SetEnvironmentVariable("CLEANROOM_OPEN_PANEL", $previousOpenPanel, "Process")
}

$healthUri = "$BaseUrl/api/health"
$deadline = (Get-Date).AddSeconds($StartTimeoutSec)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $res = Invoke-WebRequest -Uri $healthUri -UseBasicParsing -Method GET -TimeoutSec 3
        if ([int]$res.StatusCode -eq 200) {
            $ready = $true
            break
        }
    }
    catch {
        Start-Sleep -Milliseconds 400
    }
}

if (-not $ready) {
    if (-not $KeepRunning) {
        @(
            Get-Process -Name $BackendProcessName -ErrorAction SilentlyContinue
            Get-Process -Name $LegacyBackendProcessName -ErrorAction SilentlyContinue
        ) | Where-Object {
            $_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -eq $exeFull)
        } | Stop-Process -Force
    }
    throw "Backend did not become healthy within $StartTimeoutSec seconds ($healthUri)."
}

function Test-JsonShape {
    param(
        [Parameter(Mandatory = $true)][string]$Content,
        [string]$Kind = "",
        [string[]]$Required = @()
    )

    if (-not $Kind) {
        return @{ ok = $true; msg = "" }
    }

    $parsed = $null
    try {
        $parsed = $Content | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        return @{ ok = $false; msg = "invalid JSON payload" }
    }

    if ($Kind -eq "array") {
        if (-not ($parsed -is [System.Array])) {
            return @{ ok = $false; msg = "expected JSON array" }
        }
        return @{ ok = $true; msg = "" }
    }

    if ($Kind -eq "object") {
        if (-not ($parsed -is [PSCustomObject] -or $parsed -is [hashtable])) {
            return @{ ok = $false; msg = "expected JSON object" }
        }

        $propNames = @()
        if ($parsed -is [hashtable]) {
            $propNames = @($parsed.Keys)
        }
        else {
            $propNames = @($parsed.PSObject.Properties.Name)
        }

        foreach ($name in @($Required)) {
            if ($propNames -notcontains $name) {
                return @{ ok = $false; msg = "missing key '$name'" }
            }
        }
        return @{ ok = $true; msg = "" }
    }

    return @{ ok = $false; msg = "unknown shape kind '$Kind'" }
}

$stationId = 1
try {
    $stationsProbe = Invoke-WebRequest -Uri "$BaseUrl/api/stations" -UseBasicParsing -Method GET -TimeoutSec 8
    if ([int]$stationsProbe.StatusCode -eq 200) {
        $stationsJson = $stationsProbe.Content | ConvertFrom-Json
        if ($stationsJson -and $stationsJson.stations -and @($stationsJson.stations).Count -gt 0) {
            $candidate = [int](@($stationsJson.stations)[0].id)
            if ($candidate -gt 0) {
                $stationId = $candidate
            }
        }
    }
}
catch {
    # keep default station id
}

$checks = @(
    @{ path = "/"; expect = 200; kind = "" },
    @{ path = "/static/app.js"; expect = 200; kind = "" },
    @{ path = "/api/health?station_id=$stationId"; expect = 200; kind = "object"; required = @("status", "engine_running", "dependencies") },
    @{ path = "/api/stations"; expect = 200; kind = "object"; required = @("stations") },
    @{ path = "/api/liquidsoap/status?station_id=$stationId"; expect = 200; kind = "object"; required = @("alive", "active_station_id") },
    @{ path = "/api/library/import/ytdlp/jobs/status?limit_recent=25"; expect = 200; kind = "object"; required = @("queue", "recent", "counts") },
    @{ path = "/api/tracks?station_id=$stationId&page=1&per_page=5"; expect = 200; kind = "object"; required = @("tracks", "page", "total_pages") },
    @{ path = "/api/playlists?station_id=$stationId"; expect = 200; kind = "array" },
    @{ path = "/api/playlists?station_id=undefined"; expect = 200; kind = "array" },
    @{ path = "/api/queue?station_id=$stationId"; expect = 200; kind = "object"; required = @("items", "total") },
    @{ path = "/api/program/queue?station_id=$stationId"; expect = 200; kind = "object"; required = @("items", "source", "effective_source") },
    @{ path = "/api/schedule?station_id=$stationId"; expect = 200; kind = "array" },
    @{ path = "/api/schedule/timeline?station_id=$stationId"; expect = 200; kind = "object"; required = @("items", "blocks") },
    @{ path = "/api/ad-break-sets?station_id=$stationId"; expect = 200; kind = "object"; required = @("break_sets") },
    @{ path = "/api/ad-campaigns?station_id=$stationId"; expect = 200; kind = "object"; required = @("campaigns") },
    @{ path = "/api/ads/runtime?station_id=$stationId"; expect = 200; kind = "object"; required = @("due_slots", "next_slots", "history") },
    @{ path = "/api/settings/station?station_id=$stationId"; expect = 200; kind = "object"; required = @("settings", "station") },
    @{ path = "/api/logs?station_id=$stationId&scope=play&per_page=25"; expect = 200; kind = "object"; required = @("logs") }
)

foreach ($check in $checks) {
    $uri = "$BaseUrl$($check.path)"
    try {
        $res = Invoke-WebRequest -Uri $uri -UseBasicParsing -Method GET -TimeoutSec 8
        $code = [int]$res.StatusCode
        if ($code -ne [int]$check.expect) {
            $endpointFailures += "GET $($check.path) => $code (expected $($check.expect))"
        }
        else {
            $shapeResult = Test-JsonShape -Content $res.Content -Kind ([string]$check.kind) -Required @($check.required)
            if (-not $shapeResult.ok) {
                $endpointFailures += "GET $($check.path) => shape error ($($shapeResult.msg))"
            }
            else {
                Write-Output "OK  GET $($check.path) => $code"
            }
        }
    }
    catch {
        if ($_.Exception.Response) {
            $code = [int]$_.Exception.Response.StatusCode.value__
            $endpointFailures += "GET $($check.path) => $code (expected $($check.expect))"
        }
        else {
            $endpointFailures += "GET $($check.path) => ERROR ($($_.Exception.Message))"
        }
    }
}

if (-not $KeepRunning) {
    @(
        Get-Process -Name $BackendProcessName -ErrorAction SilentlyContinue
        Get-Process -Name $LegacyBackendProcessName -ErrorAction SilentlyContinue
    ) | Where-Object {
        $_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -eq $exeFull)
    } | Stop-Process -Force
}

if ($endpointFailures.Count -gt 0) {
    Write-Output ""
    Write-Output "Smoke test failures:"
    $endpointFailures | ForEach-Object { Write-Output " - $_" }
    exit 1
}

Write-Output ""
Write-Output "Smoke test passed."
if ($KeepRunning) {
    Write-Output "Process left running (PID=$($started.Id))."
}
