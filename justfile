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
    cd src-tauri && cargo run

# Run the application (release mode)
run-release: build-frontend build-backend-release
    cd src-tauri && cargo run --release

# Clean all build artifacts
clean:
    rm -rf node_modules dist
    cd src-tauri && cargo clean

# Development server (requires frontend build first)
dev: build-frontend
    cd src-tauri && cargo run

# Run tests
test:
    cd src-tauri && cargo test

# Format Rust code
fmt:
    cd src-tauri && cargo fmt

# Check Rust code
check:
    cd src-tauri && cargo check

# Quick development cycle: build frontend and run
quick: build-frontend
    cd src-tauri && cargo run

# Full rebuild from scratch
rebuild: clean build run

# Run web server mode for phone access
web: build-frontend
    cd src-tauri && cargo run --bin opcode-web

# Run web server on custom port
web-port PORT: build-frontend
    cd src-tauri && cargo run --bin opcode-web -- --port {{PORT}}

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

# Run frontend dev server (0.0.0.0 - for phone access)
dev-web:
    bun run dev

# Show local IP for phone access
ip:
    @echo "🌐 Your PC's IP addresses:"
    @ip route get 1.1.1.1 | grep -oP 'src \K\S+' || echo "Could not detect IP"
    @echo ""
    @echo "📱 Use this IP on your phone: http://YOUR_IP:8080"

# Show build information
info:
    @echo "🚀 Opcode - Claude Code GUI Application"
    @echo "Built for NixOS without Docker"
    @echo ""
    @echo "📦 Frontend: React + TypeScript + Vite"
    @echo "🦀 Backend: Rust + Tauri"
    @echo "🏗️  Build System: Nix + Just"
    @echo ""
    @echo "💡 Common commands:"
    @echo "  just run       - Build and run (desktop)"
    @echo "  just web       - Run Tauri web server for phone access"
    @echo "  just dev-web   - Run frontend dev server (0.0.0.0:1420)"
    @echo "  just quick     - Quick build and run"
    @echo "  just rebuild   - Full clean rebuild"
    @echo "  just shell     - Enter Nix environment"
    @echo "  just deps      - Install Tauri system dependencies"
    @echo "  just ip        - Show IP for phone access"

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