param(
  [int]$WaitSeconds = 90
)

$ErrorActionPreference = "Stop"
$DockerDownloadUrl = "https://www.docker.com/products/docker-desktop/"

function Write-Step {
  param([string]$Message)
  Write-Host $Message
}

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-DockerRunning {
  try {
    docker info *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Test-DockerCompose {
  try {
    docker compose version *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Start-DockerDesktop {
  $paths = @()

  if ($env:ProgramFiles) {
    $paths += Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  }

  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  if ($programFilesX86) {
    $paths += Join-Path $programFilesX86 "Docker\Docker\Docker Desktop.exe"
  }

  foreach ($path in $paths) {
    if (Test-Path $path) {
      Write-Step "Starting Docker Desktop..."
      Start-Process $path
      return $true
    }
  }

  return $false
}

function Wait-ForDocker {
  $elapsed = 0

  while (-not (Test-DockerRunning)) {
    if ($elapsed -ge $WaitSeconds) {
      throw "Docker did not become ready within $WaitSeconds seconds. Open Docker Desktop manually and run this script again."
    }

    Start-Sleep -Seconds 3
    $elapsed += 3
  }
}

function Install-DockerDesktop {
  if (Test-Command winget) {
    Write-Step "Installing Docker Desktop with winget..."
    winget install --exact --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
    return
  }

  if (Test-Command choco) {
    Write-Step "Installing Docker Desktop with Chocolatey..."
    choco install docker-desktop -y
    return
  }

  Write-Step "No supported Windows package manager was found."
  Write-Step "Opening Docker Desktop download page: $DockerDownloadUrl"
  Start-Process $DockerDownloadUrl
  throw "Install Docker Desktop, open it once, then run this script again."
}

if (-not (Test-Command docker)) {
  Write-Step "Docker CLI was not found."
  Install-DockerDesktop
} else {
  Write-Step "Docker CLI is installed."
}

if (-not (Test-DockerRunning)) {
  if (-not (Start-DockerDesktop)) {
    throw "Docker is installed, but Docker Desktop could not be started automatically. Open Docker Desktop manually and run this script again."
  }

  Wait-ForDocker
}

if (-not (Test-DockerCompose)) {
  throw "Docker is running, but 'docker compose' is not available. Install/update Docker Desktop and run this script again."
}

Write-Step "Docker is installed and running."
docker --version
docker compose version
Write-Step ""
Write-Step "To start this app:"
Write-Step "`${env:FRONTEND_PORT}='8090'; docker compose up --build -d"
