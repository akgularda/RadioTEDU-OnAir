param(
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$BackendExeName = "RadioTEDU-OnAir-Backend"
$LegacyBackendExeName = "cleanroom-radio-backend"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Initialize-LocalBuildEnvironment {
    $tempRoot = Join-Path $root ".tmp\build-temp"
    $pipCache = Join-Path $root ".tmp\pip-cache"
    New-Item -ItemType Directory -Force -Path $tempRoot, $pipCache | Out-Null
    $env:TEMP = $tempRoot
    $env:TMP = $tempRoot
    $env:PIP_CACHE_DIR = $pipCache
    $env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    }
    catch {
        Write-Warning "Could not force TLS 1.2 for build downloads."
    }
}

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

function Ensure-PythonPackageInstalled {
    param(
        [Parameter(Mandatory = $true)][string]$ImportName,
        [string]$InstallSpec = ""
    )

    $spec = if ($InstallSpec) { $InstallSpec } else { $ImportName }
    $probeCode = "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('$ImportName') else 1)"
    $installed = $false
    try {
        & $pythonCommand @pythonPrefixArgs -c $probeCode *> $null
        $installed = ($LASTEXITCODE -eq 0)
    }
    catch {
        $installed = $false
    }

    if ($installed) {
        Write-Output "Using Python package $ImportName"
        return
    }

    Write-Output "Installing missing Python package: $spec"
    & $pythonCommand @pythonPrefixArgs -m pip install $spec | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Could not install package: $spec"
    }
}

Initialize-LocalBuildEnvironment

$pythonCommand = $Python
$pythonPrefixArgs = @()

if ($Python -eq "python") {
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
            Write-Output "Using Python launcher target: py -3.12"
        }
    }
}

if (-not (Test-PythonTarget -Command $pythonCommand -PrefixArgs $pythonPrefixArgs)) {
    throw "Could not run Python command: $pythonCommand $($pythonPrefixArgs -join ' ')"
}

$versionText = (& $pythonCommand @pythonPrefixArgs -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')").Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Could not read Python version from: $pythonCommand $($pythonPrefixArgs -join ' ')"
}

if ($versionText -match '^\d+\.\d+$') {
    $parts = $versionText.Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    if ($major -eq 3 -and $minor -ge 14) {
        Write-Warning "Building with Python $versionText. Python 3.12 is recommended for stable PyInstaller/Pydantic behavior."
    }
}
else {
    Write-Warning "Could not parse Python version output: '$versionText'"
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

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [int]$Attempts = 8,
        [int]$DelayMs = 400
    )

    if (-not (Test-Path $Source -PathType Container)) {
        throw "Source directory not found: $Source"
    }

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        $copied = $false
        for ($i = 1; $i -le $Attempts; $i++) {
            try {
                Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force -ErrorAction Stop
                $copied = $true
                break
            }
            catch {
                if ($i -eq $Attempts) {
                    throw
                }
                Start-Sleep -Milliseconds $DelayMs
            }
        }

        if (-not $copied) {
            throw "Could not copy build artifact into package: $($_.FullName)"
        }
    }
}

function Add-LocalPythonPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = [System.IO.Path]::GetFullPath($Path)
    $parts = @()
    if ($env:PYTHONPATH) {
        $parts = @($env:PYTHONPATH -split [System.IO.Path]::PathSeparator)
    }
    if ($parts -notcontains $resolved) {
        $env:PYTHONPATH = (@($resolved) + $parts) -join [System.IO.Path]::PathSeparator
    }
}

function Get-PyInstallerVersion {
    try {
        $version = (& $pythonCommand @pythonPrefixArgs -m PyInstaller --version).Trim()
        if ($LASTEXITCODE -eq 0 -and $version) {
            return $version
        }
    }
    catch {
    }

    try {
        $version = (& $pythonCommand @pythonPrefixArgs -c "import PyInstaller; print(PyInstaller.__version__)").Trim()
        if ($LASTEXITCODE -ne 0) {
            return ""
        }
        return $version
    }
    catch {
        return ""
    }
}

function Resolve-PyPiWheelUrl {
    param(
        [Parameter(Mandatory = $true)][string]$Package,
        [string]$Version = "",
        [string[]]$PreferredPatterns = @("*py3-none-any.whl", "*py2.py3-none-any.whl", "*py3-none-win_amd64.whl")
    )

    $metadataUrl = if ($Version) {
        "https://pypi.org/pypi/$Package/$Version/json"
    }
    else {
        "https://pypi.org/pypi/$Package/json"
    }

    $metadata = Invoke-RestMethodWithRetry -Uri $metadataUrl
    $wheels = @($metadata.urls | Where-Object { $_.packagetype -eq "bdist_wheel" })
    foreach ($pattern in $PreferredPatterns) {
        $match = $wheels | Where-Object { $_.filename -like $pattern } | Select-Object -First 1
        if ($match) {
            return [pscustomobject]@{
                FileName = $match.filename
                Url = $match.url
            }
        }
    }

    throw "No compatible wheel found for $Package $Version."
}

function Invoke-RestMethodWithRetry {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [int]$Attempts = 4,
        [int]$DelaySeconds = 3
    )

    $hashProvider = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $hashProvider.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Uri))
    $hash = ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
    $jsonDir = Join-Path $root ".tmp\pypi-json"
    New-Item -ItemType Directory -Force -Path $jsonDir | Out-Null
    $jsonPath = Join-Path $jsonDir "$hash.json"

    Invoke-WebRequestWithRetry -Uri $Uri -OutFile $jsonPath -Attempts $Attempts -DelaySeconds $DelaySeconds
    return Get-Content -Path $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Invoke-WebRequestWithRetry {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$OutFile,
        [int]$Attempts = 4,
        [int]$DelaySeconds = 3
    )

    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            $parentDir = Split-Path -Parent $OutFile
            if ($parentDir) {
                New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
            }
            $downloadCode = @"
import pathlib
import shutil
import sys
import urllib.request

url = sys.argv[1]
destination = pathlib.Path(sys.argv[2])
destination.parent.mkdir(parents=True, exist_ok=True)
with urllib.request.urlopen(url, timeout=90) as response:
    with destination.open('wb') as output:
        shutil.copyfileobj(response, output)
"@
            & $pythonCommand @pythonPrefixArgs -c $downloadCode $Uri $OutFile
            if ($LASTEXITCODE -ne 0) {
                throw "Python download failed with exit code $LASTEXITCODE."
            }
            return
        }
        catch {
            if ($i -eq $Attempts) {
                throw
            }
            Write-Warning "Download failed ($i/$Attempts): $Uri. Retrying in $DelaySeconds seconds."
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

function Install-PyPiWheelToTarget {
    param(
        [Parameter(Mandatory = $true)][string]$Package,
        [Parameter(Mandatory = $true)][string]$TargetDir,
        [string]$Version = "",
        [string[]]$PreferredPatterns = @("*py3-none-any.whl", "*py2.py3-none-any.whl", "*py3-none-win_amd64.whl")
    )

    $wheel = Resolve-PyPiWheelUrl -Package $Package -Version $Version -PreferredPatterns $PreferredPatterns
    $wheelDir = Join-Path $root ".tmp\wheels"
    New-Item -ItemType Directory -Force -Path $wheelDir | Out-Null
    $wheelPath = Join-Path $wheelDir $wheel.FileName

    if (-not (Test-Path $wheelPath -PathType Leaf)) {
        Write-Output "Downloading Python wheel: $($wheel.FileName)"
        Invoke-WebRequestWithRetry -Uri $wheel.Url -OutFile $wheelPath
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($wheelPath, $TargetDir)
}

function Ensure-LocalPyInstaller {
    param([Parameter(Mandatory = $true)][string]$Version)

    $localSite = Join-Path $root "build\python-packages"
    Add-LocalPythonPath -Path $localSite

    if ((Get-PyInstallerVersion) -eq $Version) {
        Write-Output "Using repo-local PyInstaller $Version"
        return
    }

    if (-not (Remove-PathWithRetry -Path $localSite)) {
        throw "Could not clean repo-local Python package folder: $localSite"
    }
    New-Item -ItemType Directory -Force -Path $localSite | Out-Null

    Install-PyPiWheelToTarget `
        -Package "pyinstaller" `
        -Version $Version `
        -TargetDir $localSite `
        -PreferredPatterns @("*py3-none-win_amd64.whl")
    Install-PyPiWheelToTarget -Package "altgraph" -Version "0.17.5" -TargetDir $localSite
    Install-PyPiWheelToTarget -Package "pefile" -Version "2024.8.26" -TargetDir $localSite
    Install-PyPiWheelToTarget -Package "pywin32-ctypes" -Version "0.2.3" -TargetDir $localSite
    Install-PyPiWheelToTarget -Package "pyinstaller-hooks-contrib" -TargetDir $localSite

    Add-LocalPythonPath -Path $localSite
    $installedVersion = Get-PyInstallerVersion
    if ($installedVersion -ne $Version) {
        throw "Repo-local PyInstaller validation failed. Expected $Version, got '$installedVersion'."
    }

    Write-Output "Installed repo-local PyInstaller $Version into $localSite"
}

$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue)
$ffplay = (Get-Command ffplay -ErrorAction SilentlyContinue)
$ffprobe = (Get-Command ffprobe -ErrorAction SilentlyContinue)

if (-not $ffmpeg) {
    throw "ffmpeg not found in PATH. Install or add ffmpeg.exe to PATH before build."
}
if (-not $ffplay) {
    throw "ffplay not found in PATH. Install or add ffplay.exe to PATH before build."
}
if (-not $ffprobe) {
    throw "ffprobe not found in PATH. Install or add ffprobe.exe to PATH before build."
}

$requiredPyInstaller = "6.19.0"
if ((Get-PyInstallerVersion) -ne $requiredPyInstaller) {
    Ensure-LocalPyInstaller -Version $requiredPyInstaller
}
else {
    Write-Output "Using PyInstaller $requiredPyInstaller"
}

# Keep runtime data available inside packaged backend builds for cross-machine consistency.
Ensure-PythonPackageInstalled -ImportName "tzdata" -InstallSpec "tzdata"
Ensure-PythonPackageInstalled -ImportName "python_multipart" -InstallSpec "python-multipart"

$distDir = ".\dist\backend"
if (-not (Remove-PathWithRetry -Path $distDir)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $distDir = ".\dist\backend-$stamp"
    Write-Warning "Could not clean .\dist\backend (locked). Building into $distDir instead."
    if (-not (Remove-PathWithRetry -Path $distDir)) {
        throw "Could not clean fallback output folder: $distDir"
    }
}

$pyInstallerDistRoot = ".\build\backend-publish"
$pyInstallerWorkRoot = ".\build\pyinstaller-work"

# Stop any running packaged backend process to avoid file-lock failures during clean build.
$running = @(
    Get-Process -Name $BackendExeName -ErrorAction SilentlyContinue
    Get-Process -Name $LegacyBackendExeName -ErrorAction SilentlyContinue
)
if ($running) {
    $running | ForEach-Object {
        Write-Output "Stopping running process PID=$($_.Id) ($($_.Path))"
        Stop-Process -Id $_.Id -Force
    }
    Start-Sleep -Milliseconds 600
}

foreach ($buildPath in @($pyInstallerDistRoot, $pyInstallerWorkRoot)) {
    if (-not (Remove-PathWithRetry -Path $buildPath)) {
        throw "Could not clean build path (locked by another process): $buildPath"
    }
}

& $pythonCommand @pythonPrefixArgs -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --console `
    --distpath $pyInstallerDistRoot `
    --workpath $pyInstallerWorkRoot `
    --name $BackendExeName `
    --add-binary "$($ffmpeg.Source);." `
    --add-binary "$($ffplay.Source);." `
    --add-binary "$($ffprobe.Source);." `
    --add-data ".\\app\\static;app\\static" `
    --collect-all fastapi `
    --collect-all starlette `
    --collect-all uvicorn `
    --collect-all pydantic `
    --collect-all tzdata `
    --hidden-import "passlib.handlers.bcrypt" `
    --exclude-module "torch" `
    --exclude-module "torchvision" `
    --exclude-module "torchaudio" `
    --exclude-module "transformers" `
    --exclude-module "matplotlib" `
    --exclude-module "scipy" `
    --exclude-module "pytest" `
    --exclude-module "librosa" `
    --exclude-module "numba" `
    --exclude-module "llvmlite" `
    --exclude-module "pandas" `
    --exclude-module "onnxruntime" `
    --exclude-module "tensorflow" `
    ".\\run_cleanroom.py" | Out-Host

if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE."
}

$stagedOut = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $root $pyInstallerDistRoot) $BackendExeName))
if (-not (Test-Path $stagedOut -PathType Container)) {
    throw "Expected staged backend bundle was not produced at $stagedOut."
}

$distOut = [System.IO.Path]::GetFullPath((Join-Path $root $distDir))
Copy-DirectoryContents -Source $stagedOut -Destination $distOut

$builtExe = [System.IO.Path]::GetFullPath((Join-Path $distOut "$BackendExeName.exe"))
if (-not (Test-Path $builtExe)) {
    throw "Expected backend executable was not produced at $builtExe."
}

$lastPathFile = Join-Path $root "last_build_path.txt"
Set-Content -Path $lastPathFile -Value $builtExe -Encoding UTF8
Write-Output "Built backend package: $distOut"
Write-Output "Backend executable: $builtExe"
Write-Output "Recorded latest build path: $lastPathFile"
Write-Output "Runtime note: the packaged backend is launched hidden by the desktop agent and auto-opens the local panel after /api/health is ready. Set CLEANROOM_OPEN_PANEL=0 to disable auto-open."
