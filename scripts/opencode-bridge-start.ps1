<#
.SYNOPSIS
  Opencode Bridge - Start server on Windows
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-start.ps1 -Port 8787 -Mode run
  powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-start.ps1 -Port 8787 -Mode attach -AttachUrl http://localhost:4096
#>
param(
  [int]$Port = 8787,
  [ValidateSet("run","attach")]
  [string]$Mode = "run",
  [string]$AttachUrl = "http://localhost:4096"
)

$ErrorActionPreference = "Stop"

$env:BRIDGE_PORT = "$Port"
$env:OPENCODE_MODE = "$Mode"
$env:OPENCODE_ATTACH_URL = "$AttachUrl"

node bridge/opencode-bridge.mjs

