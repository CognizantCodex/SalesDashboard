#!/usr/bin/env bash
set -euo pipefail

DOCKER_DOWNLOAD_URL="https://www.docker.com/products/docker-desktop/"
WAIT_SECONDS="${DOCKER_WAIT_SECONDS:-90}"

log() {
  printf '%s\n' "$*"
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

run_elevated() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif has_command sudo; then
    sudo "$@"
  else
    log "This step requires administrator privileges, but sudo is not available."
    exit 1
  fi
}

docker_running() {
  docker info >/dev/null 2>&1
}

docker_compose_available() {
  docker compose version >/dev/null 2>&1
}

open_download_page() {
  case "$(uname -s)" in
    Darwin)
      open "$DOCKER_DOWNLOAD_URL" >/dev/null 2>&1 || true
      ;;
    Linux)
      if has_command xdg-open; then
        xdg-open "$DOCKER_DOWNLOAD_URL" >/dev/null 2>&1 || true
      fi
      ;;
  esac
}

start_docker() {
  case "$(uname -s)" in
    Darwin)
      if [ -d "/Applications/Docker.app" ]; then
        log "Starting Docker Desktop..."
        open -a Docker
        return 0
      fi
      return 1
      ;;
    Linux)
      log "Starting Docker service..."
      if has_command systemctl; then
        run_elevated systemctl enable --now docker
      elif has_command service; then
        run_elevated service docker start
      else
        return 1
      fi
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

wait_for_docker() {
  local waited=0

  until docker_running; do
    if [ "$waited" -ge "$WAIT_SECONDS" ]; then
      log "Docker is installed, but it did not become ready within ${WAIT_SECONDS}s."
      log "Open Docker Desktop manually, wait until it says Docker is running, then run this script again."
      exit 1
    fi

    sleep 3
    waited=$((waited + 3))
  done
}

install_on_macos() {
  if has_command brew; then
    log "Installing Docker Desktop with Homebrew..."
    brew install --cask docker
    start_docker || true
    return
  fi

  log "Homebrew is not installed, so automatic Docker Desktop installation is not available."
  log "Opening Docker Desktop download page: $DOCKER_DOWNLOAD_URL"
  open_download_page
  log "Install Docker Desktop, open it once, then run this script again."
  exit 1
}

install_on_linux() {
  log "Installing Docker Engine using the detected Linux package manager..."

  if has_command apt-get; then
    run_elevated apt-get update
    run_elevated apt-get install -y docker.io docker-compose-plugin
  elif has_command dnf; then
    run_elevated dnf install -y docker docker-compose-plugin
  elif has_command yum; then
    run_elevated yum install -y docker docker-compose-plugin
  elif has_command zypper; then
    run_elevated zypper --non-interactive install docker docker-compose
  elif has_command pacman; then
    run_elevated pacman -Sy --noconfirm docker docker-compose
  else
    log "No supported package manager was detected."
    log "Opening Docker download page: $DOCKER_DOWNLOAD_URL"
    open_download_page
    exit 1
  fi

  start_docker || true

  if has_command usermod && [ -n "${USER:-}" ] && ! id -nG "$USER" | grep -qw docker; then
    log "Adding $USER to the docker group..."
    run_elevated usermod -aG docker "$USER" || true
    log "You may need to sign out and sign back in before Docker runs without sudo."
  fi
}

install_docker() {
  case "$(uname -s)" in
    Darwin)
      install_on_macos
      ;;
    Linux)
      install_on_linux
      ;;
    *)
      log "Unsupported OS for this script: $(uname -s)"
      log "Install Docker Desktop manually from: $DOCKER_DOWNLOAD_URL"
      exit 1
      ;;
  esac
}

if ! has_command docker; then
  log "Docker CLI was not found."
  install_docker
else
  log "Docker CLI is installed."
fi

if ! docker_running; then
  start_docker || {
    log "Docker is installed, but it is not running."
    log "Open Docker Desktop manually, wait until it says Docker is running, then run this script again."
    exit 1
  }
  wait_for_docker
fi

if ! docker_compose_available; then
  log "Docker is running, but 'docker compose' is not available."
  log "Install/update Docker Desktop or install the Docker Compose plugin, then run this script again."
  exit 1
fi

log "Docker is installed and running."
docker --version
docker compose version
log ""
log "To start this app:"
log "FRONTEND_PORT=8090 docker compose up --build -d"
