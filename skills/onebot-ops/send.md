# 发送消息（openclaw message send）

通过 OpenClaw 的 `openclaw message send` CLI 主动发送消息，由 Channel outbound 处理，无需 Agent 工具。

## 前置条件

- Gateway 已启动：`openclaw gateway`
- OneBot 渠道已配置并连接

## target 格式

| 格式 | 说明 |
|------|------|
| `user:123456789` | 私聊该 QQ 号 |
| `group:987654321` | 群聊该群号 |
| `123456789` | 纯数字且 > 100000000 时按用户处理，否则按群处理 |
| `onebot:group:xxx` / `qq:user:xxx` | 支持 onebot/qq/lagrange 前缀 |

## 发送文本

```bash
openclaw message send --channel onebot --target user:1193466151 --message "你好"
openclaw message send --channel onebot --target group:123456789 --message "群公告内容"
```

## 发送图片（mediaUrl）

`--media` 支持 `file://` 路径、`http://` URL 或 `base64://`：

```bash
openclaw message send --channel onebot --target user:1193466151 --media "file:///tmp/screenshot.png"
openclaw message send --channel onebot --target group:123456789 --media "https://example.com/pic.jpg" --message "附带说明"
```

## 说明

- **回复场景**（用户发消息 → Agent 回复）：由 deliver 自动处理，Agent 输出 text/mediaUrl 即会送达
- **主动发送**（CLI 或工作流）：使用上述 `openclaw message send` 命令
- 无 Agent 工具挂载，减少 token 消耗，提升扩展性
