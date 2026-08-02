#Requires -Version 5.1
<#!
.SYNOPSIS
Creates or removes the per-user, unattended RadioTEDU Health Wall task.

.DESCRIPTION
The task is deliberately registered in the original interactive user's context.
It starts after logon, waits for backend services to settle, ignores duplicate
launches, and requests Task Scheduler restart the wall after an unexpected exit.
Removing it is idempotent so uninstall and interrupted upgrades remain safe.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Install', 'Remove')]
    [string]$Mode,

    [string]$ShellPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$taskName = 'RadioTEDU OnAir Health Wall'

if ($Mode -eq 'Remove') {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ShellPath) -or -not (Test-Path -LiteralPath $ShellPath -PathType Leaf)) {
    throw 'RadioTEDU Health Wall startup task requires the installed shell executable.'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ([string]::IsNullOrWhiteSpace($identity)) {
    throw 'Unable to determine the interactive user for the RadioTEDU Health Wall task.'
}

$action = New-ScheduledTaskAction `
    -Execute $ShellPath `
    -Argument '--health-wall' `
    -WorkingDirectory (Split-Path -Parent $ShellPath)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$trigger.Delay = 'PT30S'
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $taskName `
    -Description 'Starts the read-only RadioTEDU Health Wall after interactive logon and restarts it after failure.' `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null
