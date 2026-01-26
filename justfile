# Opcode - NixOS Build & Development Commands

# Show available commands
default:
    @just --list

# Enter the Nix development environment
shell:
    nix-shell

# Install frontend dependencies
install:
    npm install

# Build the React frontend
build-frontend:
    npm run build

# Build the Tauri backend (debug)
build-backend:
    cd src-tauri && cargo build

# Build the Tauri backend (release)
build-backend-release:
    cd src-tauri && cargo build --release

# Build everything (frontend + backend)
build: install build-frontend build-backend

# Run the application in development mode
run: build-frontend
    cd src-tauri && cargo run --bin opcode

# Run the application (release mode)
run-release: build-frontend build-backend-release
    cd src-tauri && cargo run --release --bin opcode

# Clean all build artifacts
clean:
    rm -rf node_modules dist
    cd src-tauri && cargo clean

# Development server (requires frontend build first)
dev: build-frontend
    cd src-tauri && cargo run --bin opcode

# Run tests
test:
    cd src-tauri && cargo test

# Run local integration tests (safe for deployment validation)
test-local: build-frontend
    @./dev-tests.sh {{flag}}

# Quick sanity check before deployment
test-quick:
    @./dev-tests.sh quick

# Run frontend tests only
test-frontend:
    @./dev-tests.sh frontend

# Run backend tests only
test-backend:
    @./dev-tests.sh backend

# Test service health
test-service:
    @./dev-tests.sh service

# Check git status
test-git:
    @./dev-tests.sh git

# Format Rust code
fmt:
    cd src-tauri && cargo fmt

# Check Rust code
check:
    cd src-tauri && cargo check

# Quick development cycle: build frontend and run
quick: build-frontend
    cd src-tauri && cargo run --bin opcode

# Full rebuild from scratch
rebuild: clean build
    cd src-tauri && cargo run --bin opcode

# Run web server mode (full stack: frontend + backend)
web: build-frontend
    cd src-tauri && cargo run --bin opcode-web

# Run web server on custom port
web-port PORT: build-frontend
    cd src-tauri && cargo run --bin opcode-web -- --port {{PORT}}

# Run web server on custom host and port
web-host-port HOST PORT: build-frontend
    cd src-tauri && cargo run --bin opcode-web -- --host {{HOST}} --port {{PORT}}

# Kill processes on port 8080
kill:
    @lsof -ti :8080 | xargs -r kill -9 && echo "✅ Port 8080 cleared" || echo "No processes on port 8080"

# Kill all opcode processes
kill-all:
    @pkill -f opcode-web && echo "✅ All opcode processes killed" || echo "No opcode processes found"

# Install Tauri system dependencies (Linux)
deps:
    sudo apt update && sudo apt install -y \
      libwebkit2gtk-4.1-dev \
      libgtk-3-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      patchelf \
      build-essential \
      curl \
      wget \
      file \
      libssl-dev \
      libxdo-dev \
      libsoup-3.0-dev \
      libjavascriptcoregtk-4.1-dev \
      libgdk-pixbuf2.0-dev \
      libcairo2-dev

# Run frontend dev server only (hot reload, no backend)
dev-web:
    bun run dev

# Run full web server (frontend + Rust backend) - best for testing!
dev-full: build-frontend
    cd src-tauri && cargo run --bin opcode-web

# Show local IP for phone access
ip:
    @echo "🌐 Your PC's IP addresses:"
    @ip route get 1.1.1.1 | grep -oP 'src \K\S+' || echo "Could not detect IP"
    @echo ""
    @echo "📱 Use this IP on your phone: http://YOUR_IP:8080"

# Show build information
info:
    @echo "🚀 Opcode - Claude Code Web Toolkit"
    @echo ""
    @echo "🏗️  Stack: React + TypeScript + Vite (Frontend) | Rust + Axum (Backend)"
    @echo ""
    @echo "💡 Web Commands:"
    @echo "  just dev-web      - Frontend only (hot reload, localhost:1420)"
    @echo "  just web          - Full stack (frontend + backend, localhost:8080)"
    @echo "  just web-port 9000 - Full stack on custom port"
    @echo "  just ip           - Show local IP for phone access"
    @echo ""
    @echo "💻 Dev Commands:"
    @echo "  just build        - Build everything"
    @echo "  just test         - Run Rust tests"

# =============================================================================
# Resilient Development Commands
# =============================================================================

# Check if opcode-web service is healthy
check-health:
    @dev-helpers/check-service.sh 8080

# Ensure service is running (auto-start if needed)
ensure-service *ARGS:
    @dev-helpers/ensure-service.sh 8080 {{ARGS}}

# Start development session with automatic service recovery
# Usage: just dev-service [command]
# If no command provided, starts interactive shell
# Includes background monitor that auto-restarts service if it crashes
dev-service *ARGS:
    @dev-helpers/dev-wrapper.sh 8080 {{ARGS}}

# Safe restart: kill service, ensure clean state, restart
restart:
    @echo "🔄 Safely restarting opcode-web service..."
    @just kill
    @sleep 1
    @just ensure-service
    @echo "✅ Service restarted successfully"

# Show service status and logs
status:
    @echo "📊 Service Status:"
    @dev-helpers/check-service.sh 8080 && echo "✅ Service is healthy" || echo "❌ Service is down"
    @echo ""
    @echo "📝 Recent logs:"
    @tail -20 /tmp/opcode-web.log 2>/dev/null || echo "No logs found"

# Follow service logs
logs:
    @tail -f /tmp/opcode-web.log

# Save current development context
save-context:
    @dev-helpers/save-context.sh

# Load latest development context
load-context:
    @cat /tmp/opcode-context/context-latest.txt 2>/dev/null || echo "No saved context found"

# Install git hooks for automatic context saving
install-hooks:
    @echo "📦 Installing git hooks..."
    @cp dev-helpers/pre-commit-hook.sh .git/hooks/pre-commit
    @chmod +x .git/hooks/pre-commit
    @echo "✅ Git hooks installed (context will auto-save before commits)"

# =============================================================================
# Container/Podman commands
# =============================================================================

# Build container image with podman
podman-build:
    podman build -t opcode:latest .

# Build container image with custom tag
podman-build-tag TAG:
    podman build -t opcode:{{TAG}} .

# Build container image with podman (no cache)
podman-build-no-cache:
    podman build --no-cache -t opcode:latest .

# Run container (web server mode)
podman-run:
    podman run -it --rm -p 8080:8080 opcode:latest

# Run container with custom port
podman-run-port PORT:
    podman run -it --rm -p {{PORT}}:8080 opcode:latest

# Run container with volume mount
podman-run-volume VOLUME:
    podman run -it --rm -p 8080:8080 -v {{VOLUME}}:/data opcode:latest

# Run container in background
podman-run-bg:
    podman run -d --name opcode -p 8080:8080 opcode:latest

# Stop running container
podman-stop:
    podman stop opcode || true
    podman rm opcode || true

# View container logs
podman-logs:
    podman logs -f opcode

# Execute shell in running container
podman-shell:
    podman exec -it opcode /bin/bash

# Remove built image
podman-clean:
    podman rmi opcode:latest || true

# Build and run in one command
podman-up: podman-build podman-run-bg
    @echo "✅ Container started! Access it at http://localhost:8080"
    @echo "View logs with: just podman-logs"
    @echo "Stop with: just podman-stop"

# Show podman commands
podman-info:
    @echo "🐳 Podman Container Commands"
    @echo ""
    @echo "Building:"
    @echo "  just podman-build           - Build container image"
    @echo "  just podman-build-tag TAG   - Build with custom tag"
    @echo "  just podman-build-no-cache  - Build without cache"
    @echo ""
    @echo "Running:"
    @echo "  just podman-run             - Run interactively"
    @echo "  just podman-run-port PORT   - Run on custom port"
    @echo "  just podman-run-volume PATH - Run with volume mount"
    @echo "  just podman-up              - Build and run in background"
    @echo ""
    @echo "Management:"
    @echo "  just podman-stop            - Stop and remove container"
    @echo "  just podman-logs            - View container logs"
    @echo "  just podman-shell           - Execute shell in container"
    @echo "  just podman-clean           - Remove built image"