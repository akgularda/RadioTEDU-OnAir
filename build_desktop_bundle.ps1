param(
    [string]$Configuration = "Release",
    [string]$RuntimeIdentifier = "win-x64",
    [bool]$AllowFrameworkDependentFallback = $false,
    [switch]$SkipBackendBuild
)

$ErrorActionPreference = "Stop"
$BackendExeName = "RadioTEDU-OnAir-Backend.exe"
$LegacyBackendExeName = "cleanroom-radio-backend.exe"
$AgentExeName = "RadioTEDU-OnAir-Agent.exe"
$ShellExeName = "RadioTEDU-OnAir.exe"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Resolve-DotNetCommand {
    $desktopProjectProbe = Join-Path $root "desktop\src\CleanroomRadio.Shell\CleanroomRadio.Shell.csproj"
    $systemDotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($systemDotnet -and (Test-Path $desktopProjectProbe)) {
        try {
            $sdkList = @(& $systemDotnet.Path --list-sdks 2>$null)
            if ($LASTEXITCODE -eq 0) {
                foreach ($sdk in $sdkList) {
                    if ($sdk -match '^8\.') {
                        Write-Host "Using system .NET SDK: $($systemDotnet.Path)"
                        return $systemDotnet.Path
                    }
                }
            }
        }
        catch {
            Write-Warning "System dotnet probe failed. Falling back to repo-local bootstrap."
        }
    }

    $ensureScript = Join-Path $root "scripts\ensure_dotnet.ps1"
    if (-not (Test-Path $ensureScript)) {
        throw "Local .NET bootstrap script not found: $ensureScript"
    }

    Write-Host "Bootstrapping local .NET SDK via $ensureScript"
    $dotnetCandidates = & powershell -ExecutionPolicy Bypass -File $ensureScript -InstallDir (Join-Path $root ".dotnet")

    if ($LASTEXITCODE -ne 0) {
        throw "Local .NET bootstrap failed."
    }

    $dotnetCommand = @($dotnetCandidates | Where-Object { $_ -and $_.Trim() }) | Select-Object -Last 1
    if (-not $dotnetCommand) {
        throw "Local .NET bootstrap did not return a dotnet executable path."
    }

    return $dotnetCommand.Trim()
}

function Remove-PathWithRetry {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$Attempts = 8,
        [int]$DelayMs = 400
    )

    if (-not (Test-Path $Path)) {
        return $true
    }

    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            Remove-Item $Path -Recurse -Force -ErrorAction Stop
            return $true
        }
        catch {
            if ($i -eq $Attempts) {
                return $false
            }
            Start-Sleep -Milliseconds $DelayMs
        }
    }

    return $false
}

function Reset-Directory {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    if (-not (Remove-PathWithRetry -Path $Path)) {
        throw "Could not clean output folder: $Path"
    }

    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Copy-PublishTree {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
}

function Resolve-BackendExecutable {
    param(
        [Parameter(Mandatory = $true)][string]$CanonicalPath
    )

    $lastBuildPathFile = Join-Path $root "last_build_path.txt"
    if (Test-Path $lastBuildPathFile) {
        $lastBuiltExe = Get-Content -Path $lastBuildPathFile -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not [string]::IsNullOrWhiteSpace([string]$lastBuiltExe)) {
            $lastBuiltExe = ([string]$lastBuiltExe).Trim()
            if (
                [System.IO.Path]::IsPathRooted($lastBuiltExe) -and
                (Test-Path $lastBuiltExe -PathType Leaf)
            ) {
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CanonicalPath) | Out-Null
                if ([System.IO.Path]::GetFullPath($lastBuiltExe) -ne [System.IO.Path]::GetFullPath($CanonicalPath)) {
                    Copy-Item -Path $lastBuiltExe -Destination $CanonicalPath -Force
                }
                return [System.IO.Path]::GetFullPath($CanonicalPath)
            }
        }
    }

    if (Test-Path $CanonicalPath -PathType Leaf) {
        return [System.IO.Path]::GetFullPath($CanonicalPath)
    }

    $distRoot = Join-Path $root "dist"
    $candidatePaths = @()
    if (Test-Path $distRoot) {
        foreach ($exeName in @($BackendExeName, $LegacyBackendExeName)) {
            $candidatePaths += Get-ChildItem -Path $distRoot -Recurse -Filter $exeName -File -ErrorAction SilentlyContinue |
                ForEach-Object { $_.FullName }
        }
    }

    $candidatePaths += Get-ChildItem -Path $root -Directory -Filter "dist*" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -ne $distRoot } |
        ForEach-Object {
            foreach ($exeName in @($BackendExeName, $LegacyBackendExeName)) {
                Get-ChildItem -Path $_.FullName -Recurse -Filter $exeName -File -ErrorAction SilentlyContinue |
                    ForEach-Object { $_.FullName }
            }
        }

    $candidates = $candidatePaths |
        Where-Object { $_ -and (Test-Path $_ -PathType Leaf) } |
        Sort-Object {
            (Get-Item $_).LastWriteTimeUtc
        } -Descending

    if ($candidates -and @($candidates).Count -gt 0) {
        $candidate = @($candidates)[0]
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CanonicalPath) | Out-Null
        Copy-Item -Path $candidate -Destination $CanonicalPath -Force
        return [System.IO.Path]::GetFullPath($CanonicalPath)
    }

    throw "Backend executable not found: $CanonicalPath"
}

function Invoke-DotNetPublish {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectPath,
        [Parameter(Mandatory = $true)][string]$OutputDir,
        [Parameter(Mandatory = $true)][string]$DotNetCommand,
        [bool]$SelfContained = $true
    )

    $mode = if ($SelfContained) { "self-contained" } else { "framework-dependent" }
    Write-Output "Publishing $ProjectPath to $OutputDir ($mode)"
    $arguments = @(
        "publish"
        $ProjectPath
        "--configuration"
        $Configuration
        "--output"
        $OutputDir
    )

    if ($SelfContained) {
        $arguments += @(
            "--runtime"
            $RuntimeIdentifier
            "--self-contained"
            "true"
        )
    }
    else {
        $arguments += @(
            "--self-contained"
            "false"
            "/p:RestoreIgnoreFailedSources=true"
            "/p:RestoreTreatWarningsAsErrors=false"
            "/p:TreatWarningsAsErrors=false"
            "/p:NuGetAudit=false"
        )
    }

    & $DotNetCommand @arguments | Out-Host

    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed for $ProjectPath ($mode)"
    }

    return $mode
}

function Publish-DesktopProject {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectPath,
        [Parameter(Mandatory = $true)][string]$OutputDir,
        [Parameter(Mandatory = $true)][string]$DotNetCommand
    )

    try {
        return Invoke-DotNetPublish `
            -ProjectPath $ProjectPath `
            -OutputDir $OutputDir `
            -DotNetCommand $DotNetCommand `
            -SelfContained $true
    }
    catch {
        if (-not $AllowFrameworkDependentFallback) {
            throw
        }

        Write-Warning "$($_.Exception.Message). Retrying as framework-dependent; the installer will bootstrap .NET Desktop Runtime."
        Reset-Directory -Path $OutputDir
        return Invoke-DotNetPublish `
            -ProjectPath $ProjectPath `
            -OutputDir $OutputDir `
            -DotNetCommand $DotNetCommand `
            -SelfContained $false
    }
}

$dotnetCommand = Resolve-DotNetCommand

$backendBuildScript = Join-Path $root "build_backend_onefile.ps1"
if ($SkipBackendBuild) {
    Write-Output "Skipping backend onefile package build; using existing backend artifact."
}
else {
    Write-Output "Building backend onefile package via $backendBuildScript"
    & powershell -ExecutionPolicy Bypass -File $backendBuildScript
    if ($LASTEXITCODE -ne 0) {
        throw "Backend build failed."
    }
}

$backendExe = Resolve-BackendExecutable -CanonicalPath (Join-Path $root "dist\backend\$BackendExeName")
$lastBuildPathFile = Join-Path $root "last_build_path.txt"
Set-Content -Path $lastBuildPathFile -Value $backendExe -Encoding UTF8

$buildRoot = Join-Path $root "build\desktop"
$desktopDist = Join-Path $root "dist\desktop"
$shellPublishDir = Join-Path $buildRoot "shell-publish"
$agentPublishDir = Join-Path $buildRoot "agent-publish"
$serviceHostPublishDir = Join-Path $buildRoot "service-host-publish"
$shellBundleDir = Join-Path $desktopDist "shell"
$serviceHostBundleDir = Join-Path $desktopDist "service-host"

Reset-Directory -Path $buildRoot
Reset-Directory -Path $desktopDist
New-Item -ItemType Directory -Force -Path $shellPublishDir, $agentPublishDir, $serviceHostPublishDir, $shellBundleDir, $serviceHostBundleDir | Out-Null

$publishModes = @()
$publishModes += Publish-DesktopProject `
    -ProjectPath ".\desktop\src\CleanroomRadio.Shell\CleanroomRadio.Shell.csproj" `
    -OutputDir $shellPublishDir `
    -DotNetCommand $dotnetCommand

$publishModes += Publish-DesktopProject `
    -ProjectPath ".\desktop\src\CleanroomRadio.Agent\CleanroomRadio.Agent.csproj" `
    -OutputDir $agentPublishDir `
    -DotNetCommand $dotnetCommand

$publishModes += Publish-DesktopProject `
    -ProjectPath ".\desktop\src\CleanroomRadio.ServiceHost\CleanroomRadio.ServiceHost.csproj" `
    -OutputDir $serviceHostPublishDir `
    -DotNetCommand $dotnetCommand

Copy-PublishTree -Source $shellPublishDir -Destination $shellBundleDir
Copy-PublishTree -Source $agentPublishDir -Destination $desktopDist
Copy-PublishTree -Source $serviceHostPublishDir -Destination $serviceHostBundleDir

Copy-Item -Path (Join-Path $shellBundleDir "CleanroomRadio.Shell.exe") -Destination (Join-Path $shellBundleDir $ShellExeName) -Force
Copy-Item -Path (Join-Path $desktopDist "CleanroomRadio.Agent.exe") -Destination (Join-Path $desktopDist $AgentExeName) -Force

if ($publishModes -contains "framework-dependent") {
    Set-Content `
        -Path (Join-Path $desktopDist "requires-dotnet-desktop-runtime.txt") `
        -Value "RadioTEDU OnAir desktop bundle requires Microsoft .NET Desktop Runtime 8. The installer bootstraps it when missing." `
        -Encoding UTF8
}

Write-Output "Backend artifact: $backendExe"
Write-Output "Desktop shell artifact: $(Join-Path $shellBundleDir $ShellExeName)"
Write-Output "Desktop agent artifact: $(Join-Path $desktopDist $AgentExeName)"
Write-Output "Service host artifact: $(Join-Path $serviceHostBundleDir 'RadioTEDU-OnAir-ServiceHost.exe')"
Write-Output "Recorded latest backend path: $lastBuildPathFile"
