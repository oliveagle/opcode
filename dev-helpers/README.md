# Resilient Development Guide

## 问题背景

在开发 opcode-web 服务时,经常遇到以下问题:
- 服务进程被意外终止(编译错误、手动 kill 等)
- Claude 无法自动恢复服务,导致工作中断
- 每次需要手动检查服务状态、清理端口、重新启动

## 解决方案

我们建立了一套**可持续性迭代机制**,确保开发工作不会因为服务中断而停止。

## 核心组件

### 1. 健康检查 (Health Check)

**脚本**: `dev-helpers/check-service.sh`

**功能**:
- 检查 opcode-web 服务是否正常运行
- 验证 API 端点是否响应
- 支持重试机制(默认 3 次)

**使用**:
```bash
./dev-helpers/check-service.sh 8080  # 检查 8080 端口
just check-health                    # 使用 justfile
```

**返回值**:
- `0` - 服务健康
- `1` - 服务不健康

---

### 2. 自动恢复 (Ensure Service)

**脚本**: `dev-helpers/ensure-service.sh`

**功能**:
- 自动检测服务状态
- 如果服务未运行,自动清理端口并启动
- 等待服务启动并验证健康状态
- 记录服务日志到 `/tmp/opcode-web.log`

**使用**:
```bash
./dev-helpers/ensure-service.sh 8080
just ensure-service
```

**工作流程**:
1. 检查服务是否已运行 → 如果是,退出
2. 清理占用端口的进程
3. 启动服务(后台运行)
4. 等待最多 30 秒验证服务健康
5. 返回成功或失败

---

### 3. 开发包装器 (Development Wrapper)

**脚本**: `dev-helpers/dev-wrapper.sh`

**功能**:
- 在执行任何命令前,确保服务运行
- 如果服务停止,自动恢复
- 支持交互式 shell 或单次命令执行

**使用**:
```bash
# 启动交互式开发 shell
just dev-service

# 在确保服务运行的情况下执行命令
just dev-service curl http://localhost:8080/api/process_stats
just dev-service just test
```

**特性**:
- 导出 `OPCODE_SERVICE_URL` 环境变量
- 自定义提示符显示服务端口
- 服务在 shell 退出后继续运行

---

### 4. 上下文持久化 (Context Persistence)

**脚本**: `dev-helpers/save-context.sh`

**功能**:
- 保存当前开发状态快照
- 记录 git 状态、分支、最近提交
- 保存待办事项(如果存在)
- 记录 Cargo 构建状态

**使用**:
```bash
# 手动保存上下文
just save-context

# 加载最新上下文
just load-context
```

**保存位置**:
- `/tmp/opcode-context/context-TIMESTAMP.txt`
- `/tmp/opcode-context/context-latest.txt` (最新快照的符号链接)

**自动触发**:
- Git pre-commit hook(需要安装)

---

### 5. Git Hooks 集成

**脚本**: `dev-helpers/pre-commit-hook.sh`

**功能**:
- 每次 git commit 前自动保存上下文
- 静默运行,不影响提交流程

**安装**:
```bash
just install-hooks
```

---

## Justfile 命令

| 命令 | 功能 |
|------|------|
| `just check-health` | 检查服务健康状态 |
| `just ensure-service` | 确保服务运行(自动启动) |
| `just dev-service [cmd]` | 在确保服务的前提下执行命令 |
| `just restart` | 安全重启服务 |
| `just status` | 显示服务状态和最近日志 |
| `just logs` | 实时查看服务日志 |
| `just save-context` | 保存当前开发上下文 |
| `just load-context` | 加载最新上下文 |
| `just install-hooks` | 安装 git hooks |

---

## 推荐工作流程

### 方案 A: 使用 `just dev-service` (推荐)

**适用场景**: 长时间开发会话,需要频繁测试

```bash
# 1. 启动开发会话
just dev-service

# 2. 在会话中工作(服务自动维护)
just test
curl http://localhost:8080/api/process_stats

# 3. 需要重启服务时
just restart

# 4. 退出会话(服务继续运行)
exit
```

**优点**:
- 服务完全自动化,无需手动干预
- 即使服务崩溃,也会自动重启
- 适合长时间的迭代开发

---

### 方案 B: 使用 `just ensure-service`

**适用场景**: 偶尔检查服务状态,按需启动

```bash
# 工作前检查服务
just ensure-service

# 执行开发任务
# ...

# 如果修改了 Rust 代码,需要重启
just restart
```

**优点**:
- 轻量级,按需使用
- 不会自动重启(可能更适合某些场景)

---

### 方案 C: 手动控制(传统方式)

**适用场景**: 需要完全控制服务生命周期

```bash
# 启动服务
just web-port 8080

# 在另一个终端测试
curl http://localhost:8080/api/process_stats

# 需要重启时
just kill
just web-port 8080
```

**缺点**:
- 服务停止后不会自动恢复
- 需要手动管理进程

---

## Claude 协作指南

### 对于 Claude 来说,关键行为改变:

#### ❌ 旧模式(不稳定):
```bash
# 1. 编译代码
cd src-tauri && cargo build

# 2. 启动服务
just web

# 3. 测试
curl http://localhost:8080/api/test

# 4. 如果发现 bug,杀掉服务
pkill -f opcode-web

# 5. 重新编译...
# ❌ 此时服务已停止,后续 API 调用都会失败!
```

#### ✅ 新模式(稳定):
```bash
# 1. 编译代码
cd src-tauri && cargo build

# 2. 确保服务运行(自动启动)
just ensure-service

# 3. 测试
curl http://localhost:8080/api/test

# 4. 如果发现 bug,杀掉服务
pkill -f opcode-web

# 5. 重新编译后,再次确保服务运行
just ensure-service

# 6. 继续测试...
# ✅ 服务会自动恢复,不会中断工作流!
```

---

### Claude 最佳实践:

1. **任何需要调用 API 的操作前**,先运行 `just ensure-service`
   ```bash
   just ensure-service && curl http://localhost:8080/api/test
   ```

2. **修改 Rust 代码后**,使用 `just restart` 而不是手动 kill:
   ```bash
   just restart  # 自动 kill + 重启 + 验证
   ```

3. **长时间开发会话**,使用 `just dev-service`:
   ```bash
   just dev-service
   # 在这个 shell 中工作,服务会自动维护
   ```

4. **恢复中断的会话**,使用 `just load-context`:
   ```bash
   # Claude 可以读取上下文文件,快速恢复工作状态
   just load-context
   ```

5. **查看服务状态**,使用 `just status`:
   ```bash
   just status  # 显示健康状态 + 最近日志
   ```

---

## 实战示例

### 场景 1: 修改 Rust 后端代码

```bash
# 1. 修改代码
vim src-tauri/src/web_server.rs

# 2. 编译
cd src-tauri && cargo build

# 3. 重启服务
just restart

# 4. 验证 API
just ensure-service && curl http://localhost:8080/api/process_stats
```

---

### 场景 2: 调试 API 问题

```bash
# 1. 查看服务状态
just status

# 2. 查看日志
just logs

# 3. 如果服务已停止,自动恢复
just ensure-service

# 4. 重现问题
curl http://localhost:8080/api/test_endpoint
```

---

### 场景 3: 恢复中断的开发会话

```bash
# 1. 加载之前的上下文
just load-context

# 2. 确保服务运行
just ensure-service

# 3. 继续工作...
```

---

## 故障排查

### 服务无法启动

1. **检查日志**:
   ```bash
   tail -100 /tmp/opcode-web.log
   ```

2. **手动启动查看错误**:
   ```bash
   cd src-tauri && cargo run --bin opcode-web
   ```

3. **检查端口占用**:
   ```bash
   lsof -i :8080
   ```

---

### 健康检查失败

1. **确认服务进程**:
   ```bash
   ps aux | grep opcode-web
   ```

2. **测试 API 端点**:
   ```bash
   curl -v http://localhost:8080/api/process_stats
   ```

3. **检查数据库**:
   ```bash
   # SQLite 数据库位置
   ls -la ~/.local/share/opcode/
   ```

---

### Git hooks 不工作

1. **确认 hooks 已安装**:
   ```bash
   ls -l .git/hooks/pre-commit
   ```

2. **重新安装**:
   ```bash
   just install-hooks
   ```

---

## 扩展和自定义

### 修改默认端口

在 `justfile` 中将所有 `8080` 替换为你的端口,或修改脚本接受环境变量:

```bash
export OPCODE_PORT=3000
just ensure-service  # 需要修改脚本支持 $OPCODE_PORT
```

---

### 添加更多健康检查

编辑 `dev-helpers/check-service.sh`,添加更多端点验证:

```bash
check_health() {
    # 检查多个端点
    curl -s "http://localhost:${PORT}/api/process_stats" || return 1
    curl -s "http://localhost:${PORT}/api/sessions" || return 1
}
```

---

### 集成到 CI/CD

在 CI 中使用健康检查:

```yaml
# .github/workflows/test.yml
- name: Start service
  run: just ensure-service

- name: Run integration tests
  run: just test-integration
```

---

## 总结

这套机制的核心价值:

1. **自动化** - 服务管理自动化,减少手动操作
2. **恢复性** - 服务崩溃后自动恢复,不中断开发
3. **可追溯** - 上下文持久化,便于恢复会话
4. **透明性** - 日志和状态检查,快速定位问题
5. **开发友好** - 简单的命令,清晰的反馈

**开始使用**:
```bash
just install-hooks  # 安装 git hooks
just dev-service     # 启动开发会话
```

---

## 附录: 脚本依赖

- `bash` (所有脚本)
- `curl` (健康检查)
- `lsof` (端口管理)
- `just` (命令运行器)
- `cargo` (Rust 构建)
- `git` (版本控制)

所有工具都是常见的开发工具,通常已经预装。
