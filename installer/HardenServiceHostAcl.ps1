[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OnAirRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$systemSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")
$administratorsSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
$allowedSids = @($systemSid.Value, $administratorsSid.Value)
$inheritanceFlags = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
    [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
$propagationFlags = [System.Security.AccessControl.PropagationFlags]::None
$fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$relativePaths = @(
    "Services",
    (Join-Path "State" "ServiceHost"),
    (Join-Path "Logs" "ServiceHost")
)

foreach ($relativePath in $relativePaths) {
    $target = Join-Path $OnAirRoot $relativePath
    New-Item -ItemType Directory -Path $target -Force | Out-Null

    # Start from an empty protected DACL so pre-existing explicit or inherited Users ACEs cannot survive.
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($administratorsSid)
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $systemSid,
        $fullControl,
        $inheritanceFlags,
        $propagationFlags,
        $allow))
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $administratorsSid,
        $fullControl,
        $inheritanceFlags,
        $propagationFlags,
        $allow))
    Set-Acl -LiteralPath $target -AclObject $acl

    $verified = Get-Acl -LiteralPath $target
    if (-not $verified.AreAccessRulesProtected) {
        throw "Service-host ACL inheritance is still enabled."
    }

    $unexpected = @($verified.Access | Where-Object {
        $sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        $sid -notin $allowedSids
    })
    if ($unexpected.Count -ne 0) {
        throw "Service-host ACL contains an unexpected principal."
    }
}
