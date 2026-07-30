param(
    [scriptblock]$RuntimeInstalledCheck,
    [string]$BootstrapperUrl = "https://go.microsoft.com/fwlink/?linkid=2124703",
    [string]$BootstrapperPath = (Join-Path $env:TEMP "RadioTEDUBroadcastWall-WebView2Bootstrapper.exe"),
    [switch]$InstallDotNetDesktopRuntime,
    [scriptblock]$DotNetDesktopRuntimeInstalledCheck,
    [string]$DotNetDesktopRuntimeUrl = "https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe",
    [string]$DotNetDesktopRuntimePath = (Join-Path $PSScriptRoot "windowsdesktop-runtime-win-x64.exe"),
    [switch]$InstallOllama,
    [scriptblock]$OllamaInstalledCheck,
    [string]$OllamaInstallerUrl = "https://ollama.com/download/OllamaSetup.exe",
    [string]$OllamaInstallerPath = (Join-Path $PSScriptRoot "OllamaSetup.exe")
)

$ErrorActionPreference = "Stop"

$WebView2RuntimeClientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

function Get-WebView2RuntimeRegistryPaths {
    $userPath = "Registry::HKEY_CURRENT_USER\Software\Microsoft\EdgeUpdate\Clients\$WebView2RuntimeClientId"

    if ([Environment]::Is64BitOperatingSystem) {
        return @(
            "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$WebView2RuntimeClientId"
            $userPath
        )
    }

    return @(
        "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\EdgeUpdate\Clients\$WebView2RuntimeClientId"
        $userPath
    )
}

function Test-WebView2RuntimeRegistryValue {
    param([object]$RegistryEntry)

    if ($null -eq $RegistryEntry) {
        return $false
    }

    $versionText = [string]($RegistryEntry.pv)
    if ([string]::IsNullOrWhiteSpace($versionText)) {
        return $false
    }

    try {
        return ([version]$versionText) -gt [version]"0.0.0.0"
    }
    catch {
        return $false
    }
}

function Get-WebView2RuntimeRegistryEntry {
    foreach ($registryPath in Get-WebView2RuntimeRegistryPaths) {
        try {
            $entry = Get-ItemProperty -Path $registryPath -Name pv -ErrorAction Stop
        }
        catch {
            continue
        }

        if (Test-WebView2RuntimeRegistryValue -RegistryEntry $entry) {
            return $entry
        }
    }

    return $null
}

function Test-WebView2RuntimeInstalled {
    if ($RuntimeInstalledCheck) {
        return [bool](& $RuntimeInstalledCheck)
    }

    return $null -ne (Get-WebView2RuntimeRegistryEntry)
}

function Install-WebView2Runtime {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$InstallerPath
    )

    $parentDir = Split-Path -Parent $InstallerPath
    if ($parentDir) {
        New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }

    Write-Host "Downloading WebView2 bootstrapper from $Url"
    Invoke-WebRequest -Uri $Url -OutFile $InstallerPath
    if (-not (Test-Path $InstallerPath)) {
        throw "WebView2 bootstrapper was not downloaded to $InstallerPath."
    }

    Write-Host "Installing WebView2 runtime from $InstallerPath"
    $process = Start-Process -FilePath $InstallerPath -ArgumentList "/silent /install" -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "WebView2 bootstrapper exited with code $($process.ExitCode)."
    }

    if (-not (Test-WebView2RuntimeInstalled)) {
        throw "WebView2 runtime is still missing after bootstrap."
    }

    return $true
}

function Test-DotNetDesktopRuntimeInstalled {
    if ($DotNetDesktopRuntimeInstalledCheck) {
        return [bool](& $DotNetDesktopRuntimeInstalledCheck)
    }

    $dotnet = Get-Command "dotnet.exe" -ErrorAction SilentlyContinue
    if (-not $dotnet) {
        return $false
    }

    try {
        $runtimes = @(& $dotnet.Path --list-runtimes 2>$null)
    }
    catch {
        return $false
    }

    foreach ($runtime in $runtimes) {
        if ($runtime -match '^Microsoft\.WindowsDesktop\.App\s+8\.') {
            return $true
        }
    }

    return $false
}

function Install-DotNetDesktopRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$InstallerPath
    )

    $localInstaller = $InstallerPath
    if (-not (Test-Path $localInstaller -PathType Leaf)) {
        $localInstaller = Join-Path $env:TEMP "RadioTEDUBroadcastWall-DotNetDesktopRuntime.exe"
        $parentDir = Split-Path -Parent $localInstaller
        if ($parentDir) {
            New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
        }

        Write-Host "Downloading .NET Desktop Runtime from $Url"
        Invoke-WebRequest -Uri $Url -OutFile $localInstaller
    }

    if (-not (Test-Path $localInstaller -PathType Leaf)) {
        throw ".NET Desktop Runtime installer was not available at $localInstaller."
    }

    Write-Host "Installing .NET Desktop Runtime from $localInstaller"
    $process = Start-Process -FilePath $localInstaller -ArgumentList "/install /quiet /norestart" -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw ".NET Desktop Runtime installer exited with code $($process.ExitCode)."
    }

    if (-not (Test-DotNetDesktopRuntimeInstalled)) {
        throw ".NET Desktop Runtime is still missing after bootstrap."
    }

    return $true
}

function Test-OllamaRuntimeInstalled {
    if ($OllamaInstalledCheck) {
        return [bool](& $OllamaInstalledCheck)
    }

    $command = Get-Command "ollama.exe" -ErrorAction SilentlyContinue
    if ($command -and (Test-Path $command.Path -PathType Leaf)) {
        return $true
    }

    $candidatePaths = @()
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $candidatePaths += (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe")
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidatePaths += (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
    }
    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
        $candidatePaths += (Join-Path $programFilesX86 "Ollama\ollama.exe")
    }

    foreach ($candidate in $candidatePaths) {
        if (Test-Path $candidate -PathType Leaf) {
            return $true
        }
    }

    return $false
}

function Install-OllamaRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$InstallerPath
    )

    $localInstaller = $InstallerPath
    if (-not (Test-Path $localInstaller -PathType Leaf)) {
        $localInstaller = Join-Path $env:TEMP "RadioTEDUBroadcastWall-OllamaSetup.exe"
        $parentDir = Split-Path -Parent $localInstaller
        if ($parentDir) {
            New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
        }

        Write-Host "Downloading Ollama installer from $Url"
        Invoke-WebRequest -Uri $Url -OutFile $localInstaller
    }

    if (-not (Test-Path $localInstaller -PathType Leaf)) {
        throw "Ollama installer was not available at $localInstaller."
    }

    Write-Host "Installing Ollama runtime from $localInstaller"
    $process = Start-Process -FilePath $localInstaller -ArgumentList "/S" -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Ollama installer exited with code $($process.ExitCode)."
    }

    if (-not (Test-OllamaRuntimeInstalled)) {
        throw "Ollama runtime is still missing after bootstrap."
    }

    return $true
}

$result = [ordered]@{
    WebView2 = "present"
    DotNetDesktopRuntime = "not-requested"
    Ollama = "not-requested"
    WebView2BootstrapperUrl = $BootstrapperUrl
    WebView2BootstrapperPath = $BootstrapperPath
    DotNetDesktopRuntimeUrl = $DotNetDesktopRuntimeUrl
    DotNetDesktopRuntimePath = $DotNetDesktopRuntimePath
    OllamaInstallerUrl = $OllamaInstallerUrl
    OllamaInstallerPath = $OllamaInstallerPath
}

if (Test-WebView2RuntimeInstalled) {
    Write-Host "WebView2 runtime is already installed."
    $result["WebView2"] = "present"
}
else {
    Install-WebView2Runtime -Url $BootstrapperUrl -InstallerPath $BootstrapperPath | Out-Null
    $result["WebView2"] = "installed"
}

if ($InstallDotNetDesktopRuntime) {
    if (Test-DotNetDesktopRuntimeInstalled) {
        Write-Host ".NET Desktop Runtime is already installed."
        $result["DotNetDesktopRuntime"] = "present"
    }
    else {
        Install-DotNetDesktopRuntime -Url $DotNetDesktopRuntimeUrl -InstallerPath $DotNetDesktopRuntimePath | Out-Null
        $result["DotNetDesktopRuntime"] = "installed"
    }
}

if ($InstallOllama) {
    if (Test-OllamaRuntimeInstalled) {
        Write-Host "Ollama runtime is already installed."
        $result["Ollama"] = "present"
    }
    else {
        Install-OllamaRuntime -Url $OllamaInstallerUrl -InstallerPath $OllamaInstallerPath | Out-Null
        $result["Ollama"] = "installed"
    }
}

[pscustomobject]$result
