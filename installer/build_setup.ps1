param(
    [string]$Version = "1.0.0",
    [string]$Configuration = "Release",
    [string]$RuntimeIdentifier = "win-x64",
    [string]$InnoSetupCompiler = $env:INNO_SETUP_COMPILER,
    [switch]$SkipBackendBuild
)

$ErrorActionPreference = "Stop"
$BackendExeName = "RadioTEDU-OnAir-Backend.exe"
$AgentExeName = "RadioTEDU-OnAir-Agent.exe"
$ShellExeName = "RadioTEDU-OnAir.exe"
$SetupScriptName = "RadioTEDUBroadcastRoomSetup.iss"
$SetupBaseNamePrefix = "RadioTEDU-OnAir-Setup"

function Test-PythonTarget {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string[]]$PrefixArgs = @()
    )

    try {
        & $Command @PrefixArgs -c "import sys; print(sys.version_info[0])" *> $null
        return ($LASTEXITCODE -eq 0)
    }
    catch {
        return $false
    }
}

function Resolve-PythonInstallCommand {
    $pythonCommand = "python"
    $pythonPrefixArgs = @()

    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        $installed = @()
        try {
            $installed = @(& py -0p 2>$null)
        }
        catch {
            $installed = @()
        }

        $has312 = $false
        foreach ($line in $installed) {
            if ($line -match "V:3\.12") {
                $has312 = $true
                break
            }
        }

        if ($has312) {
            $pythonCommand = "py"
            $pythonPrefixArgs = @("-3.12")
        }
    }

    if (-not (Test-PythonTarget -Command $pythonCommand -PrefixArgs $pythonPrefixArgs)) {
        throw "Could not run Python command for installer packaging: $pythonCommand $($pythonPrefixArgs -join ' ')"
    }

    return [pscustomobject]@{
        Command = $pythonCommand
        PrefixArgs = $pythonPrefixArgs
    }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Initialize-LocalBuildEnvironment {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $root ".."))
    $tempRoot = Join-Path $repoRoot ".tmp\build-temp"
    $pipCache = Join-Path $repoRoot ".tmp\pip-cache"
    New-Item -ItemType Directory -Force -Path $tempRoot, $pipCache | Out-Null
    $env:TEMP = $tempRoot
    $env:TMP = $tempRoot
    $env:PIP_CACHE_DIR = $pipCache
    $env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
}

function Resolve-InnoSetupCommand {
    param([string]$ExplicitCompiler = "")

    if (-not [string]::IsNullOrWhiteSpace($ExplicitCompiler)) {
        if (-not (Test-Path $ExplicitCompiler -PathType Leaf)) {
            throw "Explicit Inno Setup compiler was not found: $ExplicitCompiler"
        }
        return [System.IO.Path]::GetFullPath($ExplicitCompiler)
    }

    $knownPath = @(
        (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Path,
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

    if ($knownPath) {
        return [System.IO.Path]::GetFullPath($knownPath)
    }

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "Installing Inno Setup via winget"
        & winget install --id JRSoftware.InnoSetup --silent --accept-package-agreements --accept-source-agreements | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "winget failed to install Inno Setup."
        }

        $postInstall = @(
            (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Path,
            (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
            "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
            "C:\Program Files\Inno Setup 6\ISCC.exe"
        ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

        if ($postInstall) {
            return [System.IO.Path]::GetFullPath($postInstall)
        }
    }

    throw "ISCC.exe was not found. Install open-source Inno Setup 6, pass -InnoSetupCompiler, or set INNO_SETUP_COMPILER."
}

Initialize-LocalBuildEnvironment

function Ensure-DesktopBundle {
    $bundleScript = Join-Path $root "..\build_desktop_bundle.ps1"
    if (-not (Test-Path $bundleScript)) {
        throw "Desktop bundle script not found: $bundleScript"
    }

    Write-Host "Building desktop bundle via $bundleScript"
    $bundleArgs = @(
        "-ExecutionPolicy"
        "Bypass"
        "-File"
        $bundleScript
        "-Configuration"
        $Configuration
        "-RuntimeIdentifier"
        $RuntimeIdentifier
    )
    if ([bool]$SkipBackendBuild) {
        $bundleArgs += "-SkipBackendBuild"
    }

    & powershell @bundleArgs | Out-Host

    if ($LASTEXITCODE -ne 0) {
        throw "Desktop bundle build failed."
    }

    $bundleRoot = Join-Path $root "..\dist\desktop"
    $expectedArtifacts = @(
        (Join-Path $bundleRoot $AgentExeName),
        (Join-Path $bundleRoot "shell\$ShellExeName")
    )

    foreach ($artifact in $expectedArtifacts) {
        if (-not (Test-Path $artifact)) {
            throw "Expected desktop bundle artifact was not produced: $artifact"
        }
    }
}

function Ensure-InstallerBrandAssets {
    $assetScript = Join-Path $root "generate_brand_assets.ps1"
    if (-not (Test-Path $assetScript)) {
        throw "Installer brand asset generator not found: $assetScript"
    }

    Write-Host "Generating installer brand artwork via $assetScript"
    & powershell -ExecutionPolicy Bypass -File $assetScript | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Installer brand asset generation failed."
    }
}

function Resolve-BackendArtifactPath {
    $candidatePaths = @(
        (Join-Path $root "..\dist\backend\$BackendExeName"),
        (Join-Path $root "..\build\backend-publish\RadioTEDU-OnAir-Backend\$BackendExeName"),
        (Join-Path $root "..\dist\backend\cleanroom-radio-backend.exe"),
        (Join-Path $root "..\build\backend-publish\cleanroom-radio-backend\cleanroom-radio-backend.exe")
    )

    foreach ($candidate in $candidatePaths) {
        if (Test-Path $candidate) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    throw "Backend artifact was not produced in an expected location."
}

function Ensure-PythonRequirements {
    $requirementsPath = Join-Path $root "..\requirements.lock"
    if (-not (Test-Path $requirementsPath)) {
        throw "Locked Python requirements file not found: $requirementsPath"
    }

    $pythonInstall = Resolve-PythonInstallCommand
    $displayName = $pythonInstall.Command
    if (@($pythonInstall.PrefixArgs).Count -gt 0) {
        $displayName = "$displayName $($pythonInstall.PrefixArgs -join ' ')"
    }

    Write-Host "Installing locked Python requirements via $displayName -m pip install -r $requirementsPath"
    & $pythonInstall.Command @($pythonInstall.PrefixArgs) -m pip install --only-binary=:all: -r $requirementsPath | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Python requirements installation failed."
    }
}

function Reset-InstallerOutput {
    param(
        [Parameter(Mandatory = $true)][string]$ReleaseDir
    )

    New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null

    Get-ChildItem -Path $ReleaseDir -Filter "RadioTEDUBroadcastWallSetup-*.exe" -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Get-ChildItem -Path $ReleaseDir -Filter "RadioTEDU-OnAir-Setup-*.exe" -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Get-ChildItem -Path $ReleaseDir -Filter "RadioTEDU-OnAir-Setup-*.sha256" -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Get-ChildItem -Path $ReleaseDir -Filter "CleanroomRadioSetup-*.exe" -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue

    $markerPath = Join-Path $ReleaseDir "last_setup_path.txt"
    if (Test-Path $markerPath) {
        Remove-Item $markerPath -Force -ErrorAction SilentlyContinue
    }
}

Ensure-PythonRequirements
Ensure-DesktopBundle
Ensure-InstallerBrandAssets

$backendArtifactPath = Resolve-BackendArtifactPath
$backendMarkerPath = Join-Path $root "..\last_build_path.txt"
Set-Content -Path $backendMarkerPath -Value $backendArtifactPath -Encoding UTF8
Write-Output $backendArtifactPath
Write-Output "Recorded latest backend path: $backendMarkerPath"

$iscc = Resolve-InnoSetupCommand -ExplicitCompiler $InnoSetupCompiler
$setupScript = Join-Path $root $SetupScriptName
if (-not (Test-Path $setupScript)) {
    throw "Installer script not found: $setupScript"
}

$releaseDir = Join-Path $root "..\release\setup"
Reset-InstallerOutput -ReleaseDir $releaseDir
$markerPath = Join-Path $releaseDir "last_setup_path.txt"

$setupBaseName = "$SetupBaseNamePrefix-$Version"
Write-Host "Building installer $setupBaseName.exe into $releaseDir"
$isccArguments = @(
    "/DAppVersion=$Version"
    "/O$releaseDir"
    "/F$setupBaseName"
    $setupScript
)

$process = Start-Process -FilePath $iscc -ArgumentList $isccArguments -Wait -PassThru
if ($process.ExitCode -ne 0) {
    throw "Inno Setup build failed."
}

$setupPath = Join-Path $releaseDir "$setupBaseName.exe"
if (-not (Test-Path $setupPath)) {
    throw "Expected installer was not produced: $setupPath"
}

$setupPath = [System.IO.Path]::GetFullPath($setupPath)
$checksumPath = Join-Path $releaseDir "$setupBaseName.sha256"
$checksum = (Get-FileHash -Path $setupPath -Algorithm SHA256).Hash
Set-Content -Path $checksumPath -Value "$checksum  $setupBaseName.exe" -Encoding ASCII
Set-Content -Path $markerPath -Value $setupPath -Encoding UTF8
Write-Output $setupPath
Write-Output "SHA-256 checksum: $checksumPath"
Write-Output "Recorded latest installer path: $markerPath"
