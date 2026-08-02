import subprocess
import sys
from pathlib import Path


def test_installer_setup_supports_scope_shortcuts_launch_and_bootstrap():
    root = Path(__file__).resolve().parents[2]
    text = (root / "installer" / "RadioTEDUBroadcastRoomSetup.iss").read_text(encoding="utf-8")

    assert "PrivilegesRequired=admin" in text
    assert "PrivilegesRequiredOverridesAllowed=dialog" not in text
    assert '#define AppPublisher "RadioTEDU Technologies"' in text
    assert "AppPublisher={#AppPublisher}" in text
    assert "DefaultDirName={commonpf}\\RadioTEDU\\OnAir" in text
    assert "WizardImageFile=assets\\wizard-large.bmp" in text
    assert "WizardSmallImageFile=assets\\wizard-small.bmp" in text
    assert "LicenseFile=..\\LICENSE.md" in text
    assert 'Source: "..\\LICENSE.md"; DestDir: "{app}\\licenses"' in text
    assert 'Source: "THIRD_PARTY_NOTICES.md"; DestDir: "{app}\\licenses"' in text
    assert 'Name: "desktopicon"' in text
    assert 'Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: checkedonce' in text
    assert 'Name: "startmenuicon"' in text
    assert 'Name: "autostart"' in text
    assert 'Name: "healthwallshortcut"; Description: "Create a read-only Health Wall shortcut"; GroupDescription: "Shortcuts:"; Flags: checkedonce' in text
    assert 'Name: "healthwallautostart"; Description: "Run the read-only Health Wall reliably when you sign in"; GroupDescription: "Startup:"; Flags: checkedonce' in text
    assert 'Name: "{autodesktop}\\RadioTEDU Health Wall"; Filename: "{app}\\shell\\RadioTEDU-OnAir.exe"; Parameters: "--health-wall"' in text
    assert 'Name: "{commonstartup}\\RadioTEDU Health Wall"' not in text
    assert 'Source: "ConfigureHealthWallStartup.ps1"; DestDir: "{app}\\installer"' in text
    assert 'ConfigureHealthWallStartup.ps1"" -Mode Install -ShellPath ""{app}\\shell\\RadioTEDU-OnAir.exe""' in text
    assert '[UninstallRun]' in text
    assert 'ConfigureHealthWallStartup.ps1"" -Mode Remove' in text
    assert "RadioTEDU-OnAir-Agent.exe" in text
    assert "..\\dist\\desktop\\shell\\*" in text
    assert "EnsureDesktopPrerequisites.ps1" in text
    assert "-InstallDotNetDesktopRuntime" in text
    assert "-InstallOllama" in text
    assert 'Name: "dotnet"; Description: "Install the optional .NET 8 Desktop Runtime"; GroupDescription: "Optional runtimes:"; Flags: unchecked' in text
    assert 'Name: "ollama"; Description: "Install the optional local Ollama AI runtime"; GroupDescription: "Optional runtimes:"; Flags: unchecked' in text
    assert "WizardIsTaskSelected('dotnet')" in text
    assert "WizardIsTaskSelected('ollama')" in text
    assert (
        '\'-NoProfile -ExecutionPolicy Bypass -File "\' + ScriptPath + \'" '
        "-InstallDotNetDesktopRuntime -InstallOllama'"
        not in text
    )
    assert (
        '\'-NoProfile -ExecutionPolicy Bypass -File "\' + ScriptPath + \'" '
        "-InstallDotNetDesktopRuntime'"
        not in text
    )
    assert "..\\release\\prerequisites\\windowsdesktop-runtime-win-x64.exe" in text
    assert "..\\release\\prerequisites\\OllamaSetup.exe" in text
    assert "..\\release\\prerequisites\\python-embed-amd64.zip" in text
    assert "..\\release\\prerequisites\\qwen3-tts-voice-design.zip" in text
    assert "postinstall" in text.lower()


def test_health_wall_task_contract_is_delayed_single_instance_and_restartable():
    root = Path(__file__).resolve().parents[2]
    text = (root / "installer" / "ConfigureHealthWallStartup.ps1").read_text(encoding="utf-8")

    assert "New-ScheduledTaskTrigger -AtLogOn -User $identity" in text
    assert "$trigger.Delay = 'PT30S'" in text
    assert "-LogonType Interactive -RunLevel Limited" in text
    assert "-RestartCount 999" in text
    assert "-RestartInterval (New-TimeSpan -Minutes 1)" in text
    assert "-MultipleInstances IgnoreNew" in text
    assert "Unregister-ScheduledTask -TaskName $taskName -Confirm:$false" in text


def test_official_desktop_bundle_requires_self_contained_publish():
    root = Path(__file__).resolve().parents[2]
    text = (root / "build_desktop_bundle.ps1").read_text(encoding="utf-8")

    assert '[bool]$AllowFrameworkDependentFallback = $false' in text
    assert "-SelfContained $true" in text


def test_prerequisite_bootstrap_detects_per_user_webview2_runtime_via_registry(tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = root / "installer" / "EnsureDesktopPrerequisites.ps1"

    command = rf"""
$ErrorActionPreference = 'Stop'
$global:registryPaths = @()
function Get-ItemProperty {{
    param([string]$Path, [string]$Name)
    $global:registryPaths += $Path
    if ($Path -eq 'Registry::HKEY_CURRENT_USER\Software\Microsoft\EdgeUpdate\Clients\{{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}}') {{
        return [pscustomobject]@{{ pv = '126.0.0.0' }}
    }}
    return $null
}}
function Invoke-WebRequest {{
    throw 'bootstrapper should not be downloaded when HKCU runtime is present'
}}
function Start-Process {{
    throw 'bootstrapper should not run when HKCU runtime is present'
}}
& '{script}'
if ($global:registryPaths -notcontains 'Registry::HKEY_CURRENT_USER\Software\Microsoft\EdgeUpdate\Clients\{{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}}') {{
    throw 'HKCU WebView2 runtime registry key was not inspected'
}}
"""

    result = subprocess.run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ],
        cwd=root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_prerequisite_bootstrap_detects_per_machine_webview2_runtime_via_registry(tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = root / "installer" / "EnsureDesktopPrerequisites.ps1"

    command = rf"""
$ErrorActionPreference = 'Stop'
$global:registryPaths = @()
function Get-ItemProperty {{
    param([string]$Path, [string]$Name)
    $global:registryPaths += $Path
    if ($Path -eq 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}}') {{
        return [pscustomobject]@{{ pv = '126.0.0.0' }}
    }}
    return $null
}}
function Invoke-WebRequest {{
    throw 'bootstrapper should not be downloaded when HKLM runtime is present'
}}
function Start-Process {{
    throw 'bootstrapper should not run when HKLM runtime is present'
}}
& '{script}'
if ($global:registryPaths -notcontains 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}}') {{
    throw 'HKLM WebView2 runtime registry key was not inspected'
}}
"""

    result = subprocess.run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ],
        cwd=root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_build_setup_script_ensures_bundle_and_locates_iscc():
    root = Path(__file__).resolve().parents[2]
    text = (root / "installer" / "build_setup.ps1").read_text(encoding="utf-8")

    assert "build_desktop_bundle.ps1" in text
    assert "generate_brand_assets.ps1" in text
    assert "RadioTEDUBroadcastRoomSetup.iss" in text
    assert "ISCC.exe" in text
    assert "release\\setup" in text
    assert '$ShellExeName = "RadioTEDU-OnAir.exe"' in text
    assert 'Join-Path $bundleRoot "shell\\$ShellExeName"' in text
    assert "RadioTEDU-OnAir-Agent.exe" in text
    assert "InnoSetupCompiler" in text
    assert "INNO_SETUP_COMPILER" in text
    assert "-ExplicitCompiler" in text


def test_build_setup_script_records_exact_installer_path_for_smoke_validation():
    root = Path(__file__).resolve().parents[2]
    text = (root / "installer" / "build_setup.ps1").read_text(encoding="utf-8")

    assert "last_setup_path.txt" in text
    assert 'SetupBaseNamePrefix = "RadioTEDU-OnAir-Setup"' in text
    assert "Get-FileHash -Path $setupPath -Algorithm SHA256" in text
    assert '"$setupBaseName.sha256"' in text
    assert "Set-Content" in text
    assert '$BackendExeName = "RadioTEDU-OnAir-Backend.exe"' in text
    assert "..\\dist\\backend\\$BackendExeName" in text
    assert "..\\dist\\backend\\cleanroom-radio-backend.exe" in text
    assert "..\\build\\backend-publish\\RadioTEDU-OnAir-Backend\\$BackendExeName" in text
    assert "..\\build\\backend-publish\\cleanroom-radio-backend\\cleanroom-radio-backend.exe" in text


def test_build_setup_script_uses_python_resolution_instead_of_hardcoded_py_launcher():
    root = Path(__file__).resolve().parents[2]
    text = (root / "installer" / "build_setup.ps1").read_text(encoding="utf-8")

    assert "Resolve-PythonInstallCommand" in text
    assert "py -3.12 -m pip install" not in text
    assert "backend-publish" in text
    assert "last_build_path.txt" in text


def test_build_setup_script_installs_python_requirements_before_packaging():
    root = Path(__file__).resolve().parents[2]
    text = (root / "installer" / "build_setup.ps1").read_text(encoding="utf-8").lower()

    assert "pip install -r" in text
    assert "requirements.txt" in text


def test_installer_source_is_documented_as_open_source():
    root = Path(__file__).resolve().parents[2]
    license_text = (root / "installer" / "LICENSE.md").read_text(encoding="utf-8")
    readme_text = (root / "installer" / "README.md").read_text(encoding="utf-8")
    notices_text = (root / "installer" / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    root_license = (root / "LICENSE.md").read_text(encoding="utf-8")

    assert "MIT License" in license_text
    assert "installer source" in license_text.lower()
    assert "does not change the license" in license_text
    assert "open source under" in readme_text.lower()
    assert "Inno Setup" in readme_text
    assert "ISCC.exe" in readme_text
    assert "https://github.com/jrsoftware/issrc" in notices_text
    assert "installer/LICENSE.md" in root_license


def test_prerequisite_bootstrap_downloads_webview2_runtime_when_missing(tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = root / "installer" / "EnsureDesktopPrerequisites.ps1"
    bootstrapper = tmp_path / "WebView2Bootstrapper.exe"

    command = rf"""
$ErrorActionPreference = 'Stop'
$global:runtimeInstalled = $false
function Test-WebView2RuntimeInstalled {{
    return $global:runtimeInstalled
}}
function Invoke-WebRequest {{
    param([string]$Uri, [string]$OutFile)
    Set-Content -Path $OutFile -Value "bootstrapper from $Uri" -NoNewline
}}
function Start-Process {{
    param([string]$FilePath, [string]$ArgumentList, [switch]$Wait, [switch]$PassThru)
    if (-not (Test-Path $FilePath)) {{
        throw "bootstrapper missing"
    }}
    if ($ArgumentList -notmatch '/silent') {{
        throw "bootstrapper was not launched silently"
    }}
    $global:runtimeInstalled = $true
    $global:invoked = [pscustomobject]@{{
        FilePath = $FilePath
        ArgumentList = $ArgumentList
    }}
    return [pscustomobject]@{{ ExitCode = 0 }}
}}
& '{script}' -RuntimeInstalledCheck {{ $global:runtimeInstalled }} -BootstrapperUrl 'https://example.com/webview2.exe' -BootstrapperPath '{bootstrapper}'
if (-not $global:runtimeInstalled) {{
    throw 'runtime not marked installed'
}}
if ($global:invoked.FilePath -ne '{bootstrapper}') {{
    throw 'wrong bootstrapper path'
}}
"""

    result = subprocess.run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ],
        cwd=root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_prerequisite_bootstrap_installs_ollama_when_requested(tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = root / "installer" / "EnsureDesktopPrerequisites.ps1"
    installer = tmp_path / "OllamaSetup.exe"

    command = rf"""
$ErrorActionPreference = 'Stop'
$global:ollamaInstalled = $false
function Invoke-WebRequest {{
    param([string]$Uri, [string]$OutFile)
    Set-Content -Path $OutFile -Value "ollama installer from $Uri" -NoNewline
}}
function Start-Process {{
    param([string]$FilePath, [string]$ArgumentList, [switch]$Wait, [switch]$PassThru)
    if (-not (Test-Path $FilePath)) {{
        throw "ollama installer missing"
    }}
    if ($ArgumentList -ne '/S') {{
        throw "ollama installer was not launched silently"
    }}
    $global:ollamaInstalled = $true
    return [pscustomobject]@{{ ExitCode = 0 }}
}}
& '{script}' `
    -RuntimeInstalledCheck {{ $true }} `
    -InstallOllama `
    -OllamaInstalledCheck {{ $global:ollamaInstalled }} `
    -OllamaInstallerUrl 'https://example.com/OllamaSetup.exe' `
    -OllamaInstallerPath '{installer}'
if (-not $global:ollamaInstalled) {{
    throw 'ollama runtime not marked installed'
}}
"""

    result = subprocess.run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ],
        cwd=root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_prerequisite_bootstrap_installs_dotnet_desktop_runtime_when_requested(tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = root / "installer" / "EnsureDesktopPrerequisites.ps1"
    installer = tmp_path / "windowsdesktop-runtime-win-x64.exe"

    command = rf"""
$ErrorActionPreference = 'Stop'
$global:dotnetInstalled = $false
function Invoke-WebRequest {{
    param([string]$Uri, [string]$OutFile)
    Set-Content -Path $OutFile -Value "dotnet desktop runtime from $Uri" -NoNewline
}}
function Start-Process {{
    param([string]$FilePath, [string]$ArgumentList, [switch]$Wait, [switch]$PassThru)
    if (-not (Test-Path $FilePath)) {{
        throw "dotnet runtime installer missing"
    }}
    if ($ArgumentList -notmatch '/quiet') {{
        throw "dotnet runtime installer was not launched silently"
    }}
    $global:dotnetInstalled = $true
    return [pscustomobject]@{{ ExitCode = 0 }}
}}
& '{script}' `
    -RuntimeInstalledCheck {{ $true }} `
    -InstallDotNetDesktopRuntime `
    -DotNetDesktopRuntimeInstalledCheck {{ $global:dotnetInstalled }} `
    -DotNetDesktopRuntimeUrl 'https://example.com/windowsdesktop-runtime.exe' `
    -DotNetDesktopRuntimePath '{installer}'
if (-not $global:dotnetInstalled) {{
    throw 'dotnet desktop runtime not marked installed'
}}
"""

    result = subprocess.run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ],
        cwd=root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
