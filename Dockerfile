# Multi-stage build for Opcode (Tauri + Rust application)

# Stage 1: Build frontend
FROM oven/bun:1 AS frontend-builder

WORKDIR /build

# Copy package files
COPY package.json bun.lock ./
COPY tsconfig*.json ./
COPY vite.config.ts ./
COPY index.html ./

# Install dependencies
RUN bun install

# Copy source and build
COPY src ./src
COPY src-tauri/icons ./src-tauri/icons
RUN bun run build

# Stage 2: Build Rust backend
FROM rust:bookworm AS backend-builder

WORKDIR /build

# Install build dependencies for Tauri
RUN apt-get update && apt-get install -y \
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
    libcairo2-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy Cargo files
COPY src-tauri/Cargo.toml ./src-tauri/Cargo.toml
COPY src-tauri/Cargo.lock ./src-tauri/Cargo.lock
COPY src-tauri/build.rs ./src-tauri/
COPY src-tauri/tauri.conf.json ./src-tauri/
COPY .cargo ./src-tauri/.cargo
COPY src-tauri/icons ./src-tauri/icons

# Copy source code
COPY src-tauri/src ./src-tauri/src

# Copy frontend build from previous stage
COPY --from=frontend-builder /build/dist ./dist

# Build the application (both binaries)
WORKDIR /build/src-tauri
RUN cargo build --release --bins

# Stage 3: Runtime image
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies only
RUN apt-get update && apt-get install -y \
    libwebkit2gtk-4.1-0 \
    libgtk-3-0 \
    libayatana-appindicator3-1 \
    librsvg2-2 \
    libxdo3 \
    libsoup-3.0-0 \
    libjavascriptcoregtk-4.1-0 \
    libgdk-pixbuf2.0-0 \
    libcairo2 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 opcode && \
    chown -R opcode:opcode /app

USER opcode

# Copy compiled binaries
COPY --from=backend-builder --chown=opcode:opcode \
    /build/src-tauri/target/release/opcode \
    /build/src-tauri/target/release/opcode-web \
    /app/

# Set up directory for web server content
RUN mkdir -p /app/dist

# Set default command
CMD ["/app/opcode-web"]

# Labels
LABEL maintainer="oliveagle"
LABEL description="Opcode - GUI app and Toolkit for Claude Code"
LABEL version="0.2.1"
