# 消息接收规则

## 私聊与群聊

- **私聊 (private)**：所有消息 AI 都会回复
- **群聊 (group)**：默认仅当用户 @ 机器人时 AI 才回复

## 回复投递（deliver）

Agent 的回复通过 deliver 自动发送，支持：
- **text**：纯文本消息
- **mediaUrl**：图片（`file://`、`http://`、`base64://`）
- 无需 Agent 工具，Agent 输出即会送达

## 同一问题下的多次发送（回复会话）

AI 对一条用户消息可能分多次 deliver（流式输出多块内容）。**会话追踪是内置的，无需配置**：每次收到消息时自动设置 `sessionId`（如 `onebot:group:123`）和 `replySessionId`，发送时通过 reply-context 关联到对应会话。

可选扩展：

1. **replySessionId**：每次用户发消息会生成唯一的 `replySessionId`，同一问题下的所有 deliver 共享此 ID。可通过 `getActiveReplySessionId()`（reply-context）在发送时获取。调试日志（`OPENCLAW_ONEBOT_SEND_DEBUG=1`）会输出 `sessionId` 和 `replySessionId`。

2. **onReplySessionEnd 钩子**（可选）：在 `openclaw.json` 中配置 `onReplySessionEnd` 为脚本路径，回复完成时（`info.kind === "final"`）会调用，传入：
   - `replySessionId`：本次回复会话 ID
   - `sessionId`：会话标识（如 `onebot:group:123`）
   - `to`：回复目标
   - `chunks`：已发送的所有块 `[{ index, text?, mediaUrl? }]`
   - `userMessage`：用户原始消息

```json
{
  "channels": {
    "onebot": {
      "onReplySessionEnd": "./on-reply-session-end.mjs"
    }
  }
}
```

**无需此钩子即可知道每条发送属于哪个会话**：会话在收到消息时已自动建立，发送时通过 reply-context 关联。此钩子仅用于「回复完成后做额外处理」（如日志、合并、上报）。

```js
// on-reply-session-end.mjs
export default async function (ctx) {
  const { replySessionId, chunks, userMessage } = ctx;
  const fullText = chunks.map((c) => c.text).filter(Boolean).join("\n");
  console.log(`[${replySessionId}] 用户: ${userMessage} -> AI: ${fullText}`);
  // 可做日志、合并、上报等统一处理
}
```

## 使用 message 工具发送时

若 Agent 调用 `message` 工具（action: send）发送消息或图片：
- **target 必须使用 `ctx.To` 或 `ctx.ConversationLabel`**，二者在 OneBot 中均表示回复目标
- **群聊**：target 为 `group:群号`（如 `group:1046693162`），**切勿使用 SenderId**（那是用户 QQ 号，会发到私聊）
- **私聊**：target 为 `user:用户号` 或用户号

## 表情回应（仿飞书，Lagrange/QQ NT）

用户发消息后，会**立即**在用户的消息上添加表情回应（如点赞），让用户知道已收到。AI 回复完成后再取消该表情。使用 `set_msg_emoji_like` API，需 Lagrange.Core 等支持。可通过 `thinkingEmojiId` 配置，详见 [config.md](config.md)。

## @ 逻辑

可通过 `requireMention: false` 改为群聊全部回复，详见 [config.md](config.md)。

## 新成员入群欢迎

在 `openclaw.json` 中配置：

```json
{
  "channels": {
    "onebot": {
      "groupIncrease": {
        "enabled": true,
        "message": "欢迎 {name} 加入 {groupName}！"
      }
    }
  }
}
```

### 占位符（message 模板）

| 占位符 | 说明 |
|--------|------|
| `{name}` | 新成员昵称（群名片或 QQ 昵称） |
| `{userId}` | 新成员 QQ 号 |
| `{groupName}` | 群名 |
| `{groupId}` | 群号 |
| `{avatarUrl}` | 新成员头像链接 |

### 自定义 command（生成图片并发送）

当需要根据新成员 ID 信息生成图片并发送时，配置 `command` 和 `cwd`。命令在 `cwd` 下用系统 shell 执行，通过环境变量传入上下文。

**1. 在 openclaw.json 中配置：**

```json
{
  "channels": {
    "onebot": {
      "groupIncrease": {
        "enabled": true,
        "command": "npx tsx src/openclaw/trigger/welcome.ts",
        "cwd": "C:/path/to/Tiphareth"
      }
    }
  }
}
```

- **command**：在 cwd 下执行的命令（如 `npx tsx welcome.ts`）
- **cwd**：命令执行的工作目录（绝对路径）

**2. 调用方注入参数（追加到 command 末尾）：**

| 参数 | 说明 |
|------|------|
| `--userId` | 新成员 QQ 号 |
| `--username` | 新成员昵称（含空格会正确转义） |
| `--groupId` | 群号 |

环境变量（可选补充）：`GROUP_NAME`、`AVATAR_URL`

**3. 命令两种用法：**

- **自行发送**：命令内调用 `openclaw message send` 发送图片和文本，无需输出
- **输出 JSON**：向 stdout 输出一行 JSON `{"text":"...","imagePath":"..."}` 或 `{"imageUrl":"..."}`，由 handler 代为发送

**4. Tiphareth welcome.ts 示例：**

Tiphareth 的 `welcome.ts` 生成欢迎图后调用 `openclaw message send` 发送：

```json
{
  "groupIncrease": {
    "enabled": true,
    "command": "npx tsx src/openclaw/trigger/welcome.ts",
    "cwd": "C:/Users/K/project/Lagrange.onebot/Tiphareth"
  }
}
```

需确保 Gateway 已启动，且 `openclaw` CLI 可用。

### 测试欢迎（无需真人入群）

**方式一：群内 @ 机器人并发送 /group-increase**

在群内 @ 机器人并发送 `/group-increase`，会模拟当前发送者入群并触发欢迎。上下文（userId、nickname、群名等）取自该人的真实信息。需 `groupIncrease.enabled: true`。

**方式二：CLI 脚本**

```bash
cd openclaw-onebot
npm run test:group-welcome -- --group <群号> --user <QQ号>
```

可选 `--config ./path/to/openclaw.json` 指定配置文件。脚本会连接 OneBot 并模拟指定用户入群。
