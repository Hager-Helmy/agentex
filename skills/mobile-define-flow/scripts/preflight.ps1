[CmdletBinding()]
param([string]$Config = 'config/mobile.json', [ValidateSet('android', 'ios')][string]$Platform)
$ErrorActionPreference = 'Stop'
$gateway = Join-Path $PSScriptRoot 'session.js'
$gatewayArgs = @($gateway, '--check', '--config', $Config)
if ($Platform) { $gatewayArgs += @('--platform', $Platform) }
& node @gatewayArgs
if ($LASTEXITCODE -ne 0) { throw 'BrowserStack Mobile Define Flow preflight failed.' }
