<#
.SYNOPSIS
  Opencode Bridge - Windows install checker (and optional installer)
.DESCRIPTION
  Verifies Node.js and opencode are available. Optionally installs opencode.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-install.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-install.ps1 -InstallOpencode
  powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-install.ps1 -InstallOpencode -Method scoop
#>
param(
  [switch]$InstallOpencode,
  [ValidateSet("auto","scoop","choco","npm")]
  [string]$Method = "auto"
)

$ErrorActionPreference = "Stop"

function Has-Command([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  return [bool]$cmd
}

if (-not (Has-Command "node")) {
  Write-Host "[ERR] 缺少 Node.js，请先安装 Node.js 18+（建议 20+）" -ForegroundColor Red
  exit 1
}

if (-not (Has-Command "opencode")) {
  Write-Host "[WARN] 未检测到 opencode" -ForegroundColor Yellow

  if (-not $InstallOpencode) {
    Write-Host "请先安装 opencode（任选其一）：" -ForegroundColor Cyan
    Write-Host "  - Scoop: scoop install opencode"
    Write-Host "  - Chocolatey: choco install opencode"
    Write-Host "  - npm: npm install -g opencode-ai"
    Write-Host ""
    Write-Host "或自动安装：" -ForegroundColor Cyan
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-install.ps1 -InstallOpencode -Method scoop"
    exit 1
  }

  $resolvedMethod = $Method
  if ($resolvedMethod -eq "auto") {
    if (Has-Command "scoop") { $resolvedMethod = "scoop" }
    elseif (Has-Command "choco") { $resolvedMethod = "choco" }
    else { $resolvedMethod = "npm" }
  }

  if ($resolvedMethod -eq "scoop") {
    if (-not (Has-Command "scoop")) {
      Write-Host "[ERR] 未安装 scoop，请先安装 scoop：https://scoop.sh/" -ForegroundColor Red
      exit 1
    }
    Write-Host "使用 scoop 安装 opencode..." -ForegroundColor Cyan
    scoop install opencode
  } elseif ($resolvedMethod -eq "choco") {
    if (-not (Has-Command "choco")) {
      Write-Host "[ERR] 未安装 choco，请先安装 Chocolatey：https://chocolatey.org/install" -ForegroundColor Red
      exit 1
    }
    Write-Host "使用 choco 安装 opencode..." -ForegroundColor Cyan
    choco install opencode -y
  } else {
    Write-Host "使用 npm 安装 opencode-ai..." -ForegroundColor Cyan
    npm install -g opencode-ai
  }
}

node -v
opencode --version
Write-Host "安装检查通过" -ForegroundColor Green

