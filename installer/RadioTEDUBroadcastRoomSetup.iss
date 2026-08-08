#define AppName "RadioTEDU OnAir"
#define AppPublisher "RadioTEDU Technologies"
#ifndef AppVersion
#define AppVersion "1.0.0"
#endif

[Setup]
AppId=RadioTEDUOnAir
AppName={#AppName}
AppPublisher={#AppPublisher}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
DefaultDirName={commonpf}\RadioTEDU\OnAir
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=RadioTEDU-OnAir-Setup-{#AppVersion}
OutputDir=..\release\setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
WizardResizable=no
WizardImageFile=assets\wizard-large.bmp
WizardSmallImageFile=assets\wizard-small.bmp
SetupLogging=yes
LicenseFile=..\LICENSE.md
UninstallDisplayName={#AppName}
VersionInfoCompany={#AppPublisher}
VersionInfoProductName={#AppName}
VersionInfoDescription=RadioTEDU OnAir deterministic broadcast automation
SetupIconFile=..\app\static\icons\icon.ico

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: checkedonce
Name: "startmenuicon"; Description: "Create a Start Menu shortcut"; GroupDescription: "Shortcuts:"; Flags: checkedonce
Name: "healthwallshortcut"; Description: "Create a read-only Health Wall shortcut"; GroupDescription: "Shortcuts:"; Flags: checkedonce
Name: "autostart"; Description: "Start RadioTEDU OnAir when you sign in"; GroupDescription: "Startup:"; Flags: checkedonce
Name: "healthwallautostart"; Description: "Run the read-only Health Wall reliably when you sign in"; GroupDescription: "Startup:"; Flags: checkedonce
Name: "launch"; Description: "Launch RadioTEDU OnAir after install"; GroupDescription: "After install:"; Flags: checkedonce
Name: "dotnet"; Description: "Install the optional .NET 8 Desktop Runtime"; GroupDescription: "Optional runtimes:"; Flags: unchecked
Name: "ollama"; Description: "Install the optional local Ollama AI runtime"; GroupDescription: "Optional runtimes:"; Flags: unchecked

[Files]
Source: "..\dist\backend\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\dist\desktop\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: shell\*
Source: "..\dist\desktop\shell\*"; DestDir: "{app}\shell"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\LICENSE.md"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "THIRD_PARTY_NOTICES.md"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "EnsureDesktopPrerequisites.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "HardenServiceHostAcl.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "ConfigureHealthWallStartup.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "ProvisionBroadcastPcAgents.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "NewBroadcastPcHandoffManifest.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "requirements\radiotedu-handoff-py312.lock.txt"; DestDir: "{app}\installer\requirements"; Flags: ignoreversion
Source: "templates\unified-media-source-map.json"; DestDir: "{app}\installer\templates"; Flags: ignoreversion
Source: "..\tools\radiotedu_public_state_agent.py"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "..\release\prerequisites\OllamaSetup.exe"; DestDir: "{app}\installer"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\release\prerequisites\windowsdesktop-runtime-win-x64.exe"; DestDir: "{app}\installer"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\release\prerequisites\ollama.exe"; DestDir: "{app}\prerequisites"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\release\prerequisites\python-embed-amd64.zip"; DestDir: "{app}\prerequisites"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\release\prerequisites\qwen3-tts-voice-design.zip"; DestDir: "{app}\prerequisites\models"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\release\prerequisites\runtimes\*"; DestDir: "{app}\runtimes"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "..\release\prerequisites\models\*"; DestDir: "{app}\models"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "..\release\prerequisites\tools\*"; DestDir: "{app}\tools"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist

[Dirs]
Name: "{commonappdata}\RadioTEDU\OnAir"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{commonappdata}\RadioTEDU\OnAir\Media\Songs"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{commonappdata}\RadioTEDU\OnAir\Media\Jingles"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{commonappdata}\RadioTEDU\OnAir\Media\Station IDs"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{commonappdata}\RadioTEDU\OnAir\Media\Advertisements"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{commonappdata}\RadioTEDU\OnAir\Media\Recorded Shows"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{commonappdata}\RadioTEDU\OnAir\Logs"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{commonappdata}\RadioTEDU\OnAir\State"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{commonappdata}\RadioTEDU\OnAir\Services"; Flags: uninsneveruninstall
Name: "{commonappdata}\RadioTEDU\OnAir\Logs\ServiceHost"; Flags: uninsneveruninstall
Name: "{commonappdata}\RadioTEDU\OnAir\State\ServiceHost"; Flags: uninsneveruninstall

[Icons]
Name: "{autodesktop}\RadioTEDU OnAir"; Filename: "{app}\RadioTEDU-OnAir-Agent.exe"; WorkingDir: "{app}"; IconFilename: "{app}\RadioTEDU-OnAir-Agent.exe"; IconIndex: 0; Tasks: desktopicon
Name: "{autoprograms}\RadioTEDU OnAir"; Filename: "{app}\RadioTEDU-OnAir-Agent.exe"; WorkingDir: "{app}"; IconFilename: "{app}\RadioTEDU-OnAir-Agent.exe"; IconIndex: 0; Tasks: startmenuicon
Name: "{commonstartup}\RadioTEDU OnAir"; Filename: "{app}\RadioTEDU-OnAir-Agent.exe"; WorkingDir: "{app}"; IconFilename: "{app}\RadioTEDU-OnAir-Agent.exe"; IconIndex: 0; Tasks: autostart
Name: "{autodesktop}\RadioTEDU Health Wall"; Filename: "{app}\shell\RadioTEDU-OnAir.exe"; Parameters: "--health-wall"; WorkingDir: "{app}"; IconFilename: "{app}\shell\RadioTEDU-OnAir.exe"; IconIndex: 0; Tasks: healthwallshortcut
Name: "{autoprograms}\RadioTEDU Health Wall"; Filename: "{app}\shell\RadioTEDU-OnAir.exe"; Parameters: "--health-wall"; WorkingDir: "{app}"; IconFilename: "{app}\shell\RadioTEDU-OnAir.exe"; IconIndex: 0; Tasks: healthwallshortcut

[Run]
Filename: "{app}\RadioTEDU-OnAir-Agent.exe"; Description: "Launch RadioTEDU OnAir"; Flags: nowait postinstall skipifsilent; Tasks: launch
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\installer\ConfigureHealthWallStartup.ps1"" -Mode Install -ShellPath ""{app}\shell\RadioTEDU-OnAir.exe"""; Description: "Configure reliable Health Wall startup"; Flags: runasoriginaluser runhidden waituntilterminated; Tasks: healthwallautostart

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\installer\ConfigureHealthWallStartup.ps1"" -Mode Remove"; Flags: runhidden waituntilterminated

[Code]
procedure RunDesktopPrerequisites(InstallDotNet, InstallOllama: Boolean);
var
  ResultCode: Integer;
  PowerShellPath: string;
  ScriptPath: string;
  Parameters: string;
begin
  PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  ScriptPath := ExpandConstant('{app}\installer\EnsureDesktopPrerequisites.ps1');
  Parameters := '-NoProfile -ExecutionPolicy Bypass -File "' + ScriptPath + '"';
  if InstallDotNet then
  begin
    Parameters := Parameters + ' -InstallDotNetDesktopRuntime';
  end;

  if InstallOllama then
  begin
    Parameters := Parameters + ' -InstallOllama';
  end;

  if not Exec(
    PowerShellPath,
    Parameters,
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode) then
  begin
    RaiseException('Could not start the desktop prerequisite bootstrapper.');
  end;

  if ResultCode <> 0 then
  begin
    RaiseException('Desktop prerequisite bootstrap failed.');
  end;
end;

procedure HardenServiceHostDirectories;
var
  ResultCode: Integer;
  PowerShellPath: string;
  ScriptPath: string;
  Parameters: string;
begin
  PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  ScriptPath := ExpandConstant('{app}\installer\HardenServiceHostAcl.ps1');
  Parameters := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ScriptPath +
    '" -OnAirRoot "' + ExpandConstant('{commonappdata}\RadioTEDU\OnAir') + '"';

  if not Exec(
    PowerShellPath,
    Parameters,
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode) then
  begin
    RaiseException('Could not start the service-host ACL hardening helper.');
  end;

  if ResultCode <> 0 then
  begin
    RaiseException('Service-host ACL hardening failed.');
  end;
end;

[Messages]
WelcomeLabel1=Welcome to [name]
WelcomeLabel2=This installer prepares RadioTEDU OnAir for dependable station operation. Application binaries are installed in Program Files, shared station data remains in ProgramData, and the guided setup verifies Icecast, codecs, microphone readiness, and optional AI services.
FinishedHeadingLabel=RadioTEDU OnAir is installed
FinishedLabel=Start RadioTEDU OnAir to complete station provisioning. The guided setup validates stream output, microphone input, managed media folders, and optional AI services before the wall is marked ready.

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    HardenServiceHostDirectories;
    RunDesktopPrerequisites(
      WizardIsTaskSelected('dotnet'),
      WizardIsTaskSelected('ollama'));
  end;
end;
