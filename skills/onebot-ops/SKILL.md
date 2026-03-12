---
name: onebot-ops
description: OneBot (QQ/Lagrange) 渠道运维与使用规范。消息收发通过 Channel outbound 与 deliver 完成，不依赖 Agent 工具。
---

# OneBot 运维/使用规范

OneBot v11 协议渠道，支持 QQ/Lagrange.Core/go-cqhttp。消息收发均通过 Channel 的 outbound 与 deliver 完成，**不依赖 Agent 工具**。

## 快速判断

| 场景 | 说明 |
|------|------|
| **接收消息** | 私聊全回复，群聊默认仅 @ 回复，详见 [receive.md](receive.md) |
| **message 工具 target** | 群聊必须用 `ctx.To`（格式 `group:群号`），勿用 SenderId |
| **发送消息** | 使用 `openclaw message send` CLI，详见 [send.md](send.md) |
| **配置** | 运行 `openclaw onebot setup` 或编辑 `openclaw.json`，详见 [config.md](config.md) |

## 插件安装

```bash
openclaw plugins install @openclaw/onebot
```

本地开发时：

```bash
openclaw plugins install ./openclaw-onebot
```

## 前置条件

- Gateway 已启动：`openclaw gateway`
- OneBot 实现（Lagrange.Core / go-cqhttp）已运行并暴露 WebSocket
- 在 `openclaw.json` 中配置 `channels.onebot` 或通过 `ONEBOT_WS_*` 环境变量

## OneBot 协议能力

对应 Lagrange.onebot `context.ts` 的 API：

| 能力 | 说明 |
|------|------|
| **send_private_msg** | 发送私聊消息 |
| **send_group_msg** | 发送群消息 |
| **send_msg** | 按 message_type 发送 |
| **图片消息** | message 为 `[{ type: "image", data: { file } }]` |
| **delete_msg** | 撤回消息 |
| **get_msg** | 获取单条消息 |
| **get_group_msg_history** | 获取群历史（Lagrange.Core 扩展） |
| **upload_group_file** | 上传群文件 |
| **upload_private_file** | 上传私聊文件 |
| **set_msg_emoji_like** | 表情回应（Lagrange/QQ NT 扩展） |

## 常用命令

| 命令 | 说明 |
|------|------|
| `openclaw onebot setup` | 交互式配置 OneBot 连接 |
| `openclaw message send --channel onebot --target group:xxx --message "hi"` | 发送群消息 |
| `openclaw gateway status` | 查看 Gateway 状态 |
| `openclaw logs --follow` | 查看日志 |
