
<div align="center">
  <img src="src-tauri/icons/icon.png" alt="opcode Logo" width="120" height="120">

  <h1>opcode</h1>
  
  <p>
    <strong>A powerful web toolkit for Claude Code</strong>
  </p>
  <p>
    <strong>Run anywhere - browser, server, or mobile. Create custom agents, manage interactive Claude Code sessions, run secure background agents, and more.</strong>
  </p>
  
  <p>
    <a href="#features"><img src="https://img.shields.io/badge/Features-✨-blue?style=for-the-badge" alt="Features"></a>
    <a href="#quick-start"><img src="https://img.shields.io/badge/Quick%20Start-🚀-green?style=for-the-badge" alt="Quick Start"></a>
    <a href="#architecture"><img src="https://img.shields.io/badge/Architecture-🏗️-orange?style=for-the-badge" alt="Architecture"></a>
    <a href="#development"><img src="https://img.shields.io/badge/Develop-🛠️-purple?style=for-the-badge" alt="Development"></a>
    <a href="https://discord.com/invite/KYwhHVzUsY"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  </p>
</div>

![457013521-6133a738-d0cb-4d3e-8746-c6768c82672c](https://github.com/user-attachments/assets/a028de9e-d881-44d8-bae5-7326ab3558b9)



https://github.com/user-attachments/assets/6bceea0f-60b6-4c3e-a745-b891de00b8d0



> [!TIP]
> **⭐ Star the repo and follow [@getAsterisk](https://x.com/getAsterisk) on X for early access to `asteria-swe-v0`**.

> [!NOTE]
> This project is not affiliated with, endorsed by, or sponsored by Anthropic. Claude is a trademark of Anthropic, PBC. This is an independent developer project using Claude.

## 🌟 Overview

**opcode** is a powerful web-based toolkit for Claude Code. Originally a desktop application built with Tauri, it has evolved into a modern web application that runs anywhere - in your browser, on a server, or on your phone.

Think of opcode as your command center for Claude Code - a beautiful web interface that makes AI-assisted development more intuitive and productive, accessible from any device.

## 📋 Table of Contents

- [🌟 Overview](#-overview)
- [🚀 Quick Start](#-quick-start)
- [🏗️ Architecture](#-architecture)
- [✨ Features](#-features)
- [📖 Usage](#-usage)
- [🔨 Development](#️-development)
- [🔒 Security](#-security)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)
- [🙏 Acknowledgments](#-acknowledgments)

## 🚀 Quick Start

```bash
# Clone and enter the project
git clone https://github.com/getAsterisk/opcode.git
cd opcode

# Install dependencies
bun install

# Start the web server (frontend + API)
just dev-web
```

Then open **http://localhost:1420** in your browser.

### Available Commands

| Command | Description |
|---------|-------------|
| `just dev-web` | Start frontend dev server (0.0.0.0:1420) |
| `just web` | Run full web server with Rust backend |
| `just web-port 8080` | Run web server on custom port |

## 🏗️ Architecture

```
opcode/
├── src/                   # React frontend
│   ├── components/        # UI components
│   ├── lib/               # API client & utilities
│   └── assets/            # Static assets
├── src-tauri/             # Rust backend (also serves web UI)
│   ├── src/
│   │   ├── commands/      # API handlers
│   │   ├── checkpoint/    # Timeline management
│   │   └── process/       # Process management
│   └── Cargo.toml
└── dist/                  # Built frontend assets
```

### How It Works

1. **Frontend**: React + TypeScript + Vite frontend built for the web
2. **Backend**: Rust server that handles Claude Code integration and API requests
3. **Communication**: Frontend communicates with Rust backend via REST API

The backend can be run:
- **Locally**: Access via localhost
- **On a Server**: Access via browser from anywhere
- **On Mobile**: Works on phone browsers via network IP

## ✨ Features

### 🗂️ **Project & Session Management**
- **Visual Project Browser**: Navigate through all your Claude Code projects in `~/.claude/projects/`
- **Session History**: View and resume past coding sessions with full context
- **Smart Search**: Find projects and sessions quickly with built-in search
- **Session Insights**: See first messages, timestamps, and session metadata at a glance

### 🤖 **CC Agents**
- **Custom AI Agents**: Create specialized agents with custom system prompts and behaviors
- **Agent Library**: Build a collection of purpose-built agents for different tasks
- **Background Execution**: Run agents in separate processes for non-blocking operations
- **Execution History**: Track all agent runs with detailed logs and performance metrics



### 📊 **Usage Analytics Dashboard**
- **Cost Tracking**: Monitor your Claude API usage and costs in real-time
- **Token Analytics**: Detailed breakdown by model, project, and time period
- **Visual Charts**: Beautiful charts showing usage trends and patterns
- **Export Data**: Export usage data for accounting and analysis

### 🔌 **MCP Server Management**
- **Server Registry**: Manage Model Context Protocol servers from a central UI
- **Easy Configuration**: Add servers via UI or import from existing configs
- **Connection Testing**: Verify server connectivity before use
- **Claude Desktop Import**: Import server configurations from Claude Desktop

### ⏰ **Timeline & Checkpoints**
- **Session Versioning**: Create checkpoints at any point in your coding session
- **Visual Timeline**: Navigate through your session history with a branching timeline
- **Instant Restore**: Jump back to any checkpoint with one click
- **Fork Sessions**: Create new branches from existing checkpoints
- **Diff Viewer**: See exactly what changed between checkpoints

### 📝 **CLAUDE.md Management**
- **Built-in Editor**: Edit CLAUDE.md files directly within the app
- **Live Preview**: See your markdown rendered in real-time
- **Project Scanner**: Find all CLAUDE.md files in your projects
- **Syntax Highlighting**: Full markdown support with syntax highlighting

## 📖 Usage

### Getting Started

1. **Launch opcode**: Open the application after installation
2. **Welcome Screen**: Choose between CC Agents or Projects
3. **First Time Setup**: opcode will automatically detect your `~/.claude` directory

### Managing Projects

```
Projects → Select Project → View Sessions → Resume or Start New
```

- Click on any project to view its sessions
- Each session shows the first message and timestamp
- Resume sessions directly or start new ones

### Creating Agents

```
CC Agents → Create Agent → Configure → Execute
```

1. **Design Your Agent**: Set name, icon, and system prompt
2. **Configure Model**: Choose between available Claude models
3. **Set Permissions**: Configure file read/write and network access
4. **Execute Tasks**: Run your agent on any project

### Tracking Usage

```
Menu → Usage Dashboard → View Analytics
```

- Monitor costs by model, project, and date
- Export data for reports
- Set up usage alerts (coming soon)

### Working with MCP Servers

```
Menu → MCP Manager → Add Server → Configure
```

- Add servers manually or via JSON
- Import from Claude Desktop configuration
- Test connections before using

## 🚀 Installation

### Prerequisites

- **Claude Code CLI**: Install from [Claude's official site](https://claude.ai/code)

### Release Executables Will Be Published Soon

## 🔨 Development

### Prerequisites

Before developing opcode, ensure you have:

1. **Rust** (1.70.0 or later)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Bun** (latest version)
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

3. **Git**
   - Usually pre-installed on most systems

4. **Claude Code CLI**
   - Download from [Claude's official site](https://claude.ai/code)
   - Ensure `claude` is in your PATH

### Development Commands

```bash
# Install dependencies
bun install

# Start frontend dev server (hot reload)
just dev-web

# Build and run full web server
just web

# Build frontend for production
bun run build

# Run Rust tests
cd src-tauri && cargo test

# Format Rust code
cd src-tauri && cargo fmt
```

### Access During Development

| Mode | URL | Access |
|------|-----|--------|
| Frontend dev | http://localhost:1420 | Local only |
| Full server | http://localhost:8080 | Local & network |

**For mobile/phone access:**
```bash
just ip  # Shows your local IP
# Then open http://YOUR_IP:1420 on your phone
```

## 🛠️ Tech Stack

- **Frontend**: React 18 + TypeScript + Vite 6
- **Backend**: Rust + Axum (web server)
- **UI Framework**: Tailwind CSS v4 + shadcn/ui
- **Database**: SQLite (via rusqlite)
- **Package Manager**: Bun

### Project Structure

```
opcode/
├── src/                   # React frontend
│   ├── components/        # UI components
│   ├── lib/               # API client & utilities
│   └── assets/            # Static assets
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── commands/      # API command handlers
│   │   ├── checkpoint/    # Timeline management
│   │   └── process/       # Process management
│   └── Cargo.toml
└── dist/                  # Built frontend assets
```

## 🔒 Security

opcode prioritizes your privacy and security:

1. **Process Isolation**: Agents run in separate processes
2. **Permission Control**: Configure file and network access per agent
3. **Local Storage**: All data stays on your machine
4. **No Telemetry**: No data collection or tracking
5. **Open Source**: Full transparency through open source code

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Areas for Contribution

- 🐛 Bug fixes and improvements
- ✨ New features and enhancements
- 📚 Documentation improvements
- 🎨 UI/UX enhancements
- 🧪 Test coverage
- 🌐 Internationalization

## 📄 License

This project is licensed under the AGPL License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [React](https://react.dev/) - UI framework
- [Vite](https://vitejs.dev/) - Build tool
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Claude](https://claude.ai) by Anthropic

---

<div align="center">
  <p>
    <strong>Made with ❤️ by the <a href="https://asterisk.so/">Asterisk</a></strong>
  </p>
  <p>
    <a href="https://github.com/getAsterisk/opcode/issues">Report Bug</a>
    ·
    <a href="https://github.com/getAsterisk/opcode/issues">Request Feature</a>
  </p>
</div>


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=getAsterisk/opcode&type=Date)](https://www.star-history.com/#getAsterisk/opcode&Date)
