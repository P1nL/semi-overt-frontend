#requires -Version 7.0
<#
.SYNOPSIS
Start the local frontend against the S5 microservices or the monolith.
.PARAMETER Backend
s5 (default): frontend 15173 -> gateway 18080.
monolith: frontend 5173 -> monolith 8080.
#>
[CmdletBinding()]
param(
    [ValidateSet('s5', 'monolith')]
    [string]$Backend = 's5'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Core') {
    throw 'Please run this script with PowerShell 7 (pwsh).'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$viteEntry = Join-Path $repoRoot 'node_modules/vite/bin/vite.js'
if (-not (Test-Path -LiteralPath $viteEntry -PathType Leaf)) {
    throw "Frontend dependencies are missing. Run npm ci in $repoRoot first."
}
$node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$frontendPort = if ($Backend -eq 's5') { 15173 } else { 5173 }
$proxyTarget = if ($Backend -eq 's5') { 'http://127.0.0.1:18080' } else { 'http://localhost:8080' }
$overrides = @{
    VITE_DEV_PROXY_TARGET = $proxyTarget
    # An existing absolute API override must not silently bypass the selected backend.
    VITE_API_BASE_URL = '/api/v1'
}
$previousEnvironment = @{}

Push-Location -LiteralPath $repoRoot
try {
    foreach ($name in $overrides.Keys) {
        $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $overrides[$name], 'Process')
    }
    Write-Host "Backend: $Backend ($proxyTarget)" -ForegroundColor Cyan
    Write-Host "Frontend: http://localhost:$frontendPort" -ForegroundColor Green
    Write-Host 'This starts only the frontend. Start the selected backend separately.'
    Write-Host 'Press Ctrl+C to stop. Run again with s5 or monolith to switch.'

    # Invoke the installed Vite CLI directly; no nested shell or PowerShell 5.1 fallback.
    & $node.Source $viteEntry --host 127.0.0.1 --port $frontendPort --strictPort
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend exited with code $LASTEXITCODE. Check the error above (for example, port $frontendPort is already in use)."
    }
} finally {
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    Pop-Location
}
