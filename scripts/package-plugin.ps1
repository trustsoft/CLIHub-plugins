param(
    [Parameter(Mandatory = $true)]
    [string]$Id
)

$root = Split-Path -Parent $PSScriptRoot
$pluginDir = Join-Path $root "plugins\$Id"
$descriptorPath = Join-Path $pluginDir 'plugin.json'

if (-not (Test-Path $descriptorPath)) {
    throw "Plugin folder or descriptor not found: $pluginDir"
}

$descriptor = Get-Content $descriptorPath -Raw | ConvertFrom-Json
$version = [string]$descriptor.version

if ($descriptor.id -ne $Id) {
    throw "plugin.json id '$($descriptor.id)' does not match the folder name '$Id'"
}

if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw "plugin.json version '$version' must be major.minor.patch"
}

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$zipPath = Join-Path $dist "$Id-$version.clihub-plugin.zip"

Compress-Archive -Path $pluginDir -DestinationPath $zipPath -Force
Write-Host "Created $zipPath"
