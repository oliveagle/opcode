# Resilient Development - Quick Start

## 立即开始

```bash
# 1. 安装 git hooks(可选,自动保存上下文)
just install-hooks

# 2. 启动开发会话(服务自动维护)
just dev-service
```

## 核心命令(记住这些就够了)

| 命令 | 何时使用 |
|------|---------|
| `just dev-service` | 长时间开发会话 |
| `just ensure-service` | 任何 API 调用前 |
| `just restart` | 修改 Rust 代码后 |
| `just status` | 查看服务状态 |
| `just logs` | 查看实时日志 |

## 典型工作流

```bash
# 开发前
just dev-service

# 修改代码 + 测试
vim src-tauri/src/web_server.rs
just restart                 # 自动重启服务
curl http://localhost:8080/api/test

# 需要暂停?保存上下文
just save-context

# 恢复工作
just load-context           # 查看之前的状态
just ensure-service         # 确保服务运行
```

## Claude 协作要点

✅ **Claude 应该这样做**:
1. 任何 API 调用前: `just ensure-service`
2. 修改 Rust 代码后: `just restart`
3. 服务停止时: `just ensure-service` (自动恢复)
4. 需要调试时: `just status` 或 `just logs`

❌ **Claude 不应该这样做**:
1. 手动 `pkill` 后不恢复服务
2. 直接调用 API 而不检查服务状态
3. 使用 `just web` 而不是 `just dev-service`

## 一键测试健康

```bash
just check-health   # 服务健康返回 0
```

## 查看完整文档

```bash
cat dev-helpers/README.md
```
