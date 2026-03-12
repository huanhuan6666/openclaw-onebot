# 配置参数

## 参数表

| 参数 | 说明 |
|------|------|
| type | `forward-websocket` / `backward-websocket` |
| host | OneBot 主机地址 |
| port | 端口 |
| accessToken | 访问令牌（可选） |
| path | 反向 WS 路径，默认 `/onebot/v11/ws` |
| requireMention | 群聊是否需 @ 才回复，默认 `true` |
| whitelistUserIds | 白名单 QQ 号数组，非空时仅白名单内用户可触发 AI；为空则所有人可回复 |
| renderMarkdownToPlain | 是否将 Markdown 转为纯文本再发送，默认 `true` |
| collapseDoubleNewlines | 是否将连续多个换行压缩为单个，默认 `true`（减少 AI 输出的双空行） |
| longMessageMode | 长消息模式：`normal` 正常发送、`og_image` 生成图片、`forward` 合并转发 |
| longMessageThreshold | 长消息阈值（字符数），超过则启用 longMessageMode，默认 300 |
| thinkingEmojiId | 表情 ID（set_msg_emoji_like），默认 60 |
| groupIncrease | 新成员入群欢迎（enabled、message、command、cwd），详见 [receive.md](receive.md) |
| activityInterject | 群聊"活跃期偶尔插话"模式（保留 @ 触发），详见下方 |

## TUI 配置

运行 `openclaw onebot setup` 进行交互式配置。

配置写入 `openclaw.json` 的 `channels.onebot` 或通过 `ONEBOT_WS_*` 环境变量提供。

所有 `channels.onebot` 下的配置修改保存后**立即热生效**，无需重启 gateway。

## 环境变量

| 变量 | 说明 |
|------|------|
| ONEBOT_WS_TYPE | forward-websocket / backward-websocket |
| ONEBOT_WS_HOST | 主机地址 |
| ONEBOT_WS_PORT | 端口 |
| ONEBOT_WS_ACCESS_TOKEN | 访问令牌 |
| ONEBOT_WS_PATH | 反向 WS 路径 |

## activityInterject 配置（群活跃偶尔插话）

适合"默认只 @ 才回复，但群里热起来时偶尔自然插话"的场景。修改后**立即热生效**。

### 工作流程

```
群消息到达
  → 记录到 events[] 和 recentMessages[]
  → 检查是否在活跃窗口内（activeUntil > now）
    ├─ 不在窗口内 → 检查是否触发新窗口
    │   ├─ 被 @bot（mentionActivates）→ 开启活跃窗口
    │   └─ 热度达标（heatActivates）→ 开启活跃窗口
    └─ 在窗口内 → 检查是否该插话
        ├─ 已达 maxRepliesPerWindow → 跳过
        ├─ 距上次插话 < minGapMs → 跳过
        ├─ 消息太短 < minMessageLength → 跳过
        ├─ 纯标点符号 → 跳过
        └─ random() > randomChance → 跳过（概率过滤）
        → 全部通过 → 触发插话
```

### 完整参数表

```json
{
  "channels": {
    "onebot": {
      "requireMention": true,
      "activityInterject": {
        "enabled": true,
        "groupIds": [676266126, 514242535],
        "mentionActivates": true,
        "heatActivates": true,
        "activeWindowMs": 120000,
        "heatWindowMs": 45000,
        "heatMessageThreshold": 2,
        "heatUniqueUsersThreshold": 1,
        "minGapMs": 5000,
        "maxRepliesPerWindow": 100,
        "randomChance": 1,
        "minMessageLength": 2
      }
    }
  }
}
```

### 参数详解

#### 基础开关

| 参数 | 类型 | 默认值 | 范围 | 说明 |
|------|------|--------|------|------|
| `enabled` | bool | `false` | — | 总开关 |
| `groupIds` | number[] | `[]` | — | 只在这些群启用；空数组 = 所有群 |

#### 窗口触发（什么时候开始活跃）

| 参数 | 类型 | 默认值 | 范围 | 说明 |
|------|------|--------|------|------|
| `mentionActivates` | bool | `true` | — | 被 @bot 后开启活跃窗口 |
| `heatActivates` | bool | `true` | — | 群聊热度达标时自动开启活跃窗口 |
| `activeWindowMs` | number | `600000`(10min) | 1min~1h | 活跃窗口持续时长。窗口内才会考虑插话 |
| `heatWindowMs` | number | `45000`(45s) | 10s~5min | 热度检测的滑动窗口。在此时间段内统计消息数和发言人数 |
| `heatMessageThreshold` | number | `8` | 2~100 | 热度窗口内达到多少条消息才算"热" |
| `heatUniqueUsersThreshold` | number | `3` | 1~30 | 热度窗口内至少多少**不同的人**发言才算"热" |

#### 插话频率控制（活跃窗口内多久插一次）

| 参数 | 类型 | 默认值 | 范围 | 说明 |
|------|------|--------|------|------|
| `minGapMs` | number | `180000`(3min) | 10s~1h | 两次插话的最小间隔 |
| `maxRepliesPerWindow` | number | `2` | 1~20 | 每个活跃窗口最多插话次数。窗口到期后重置 |
| `randomChance` | number | `0.2` | 0~1 | 通过前面所有条件后，再以此概率决定是否插话。1=必插，0.2=20%概率 |
| `minMessageLength` | number | `2` | 1~50 | 触发消息至少多少字（去空格后），太短的不值得回 |

#### 插话的上下文与风格

插话时不再做 prompt 注入。消息原样走正常回复流程，由 `sessionHistories`（最近50条群聊记录）提供上下文，`SOUL.md` + `AGENTS.md` 中的群聊行为指令控制回复风格。

> 以下参数在代码中仍被解析但**实际未使用**（历史遗留），配置与否不影响行为：
> `recentContextSize`、`recentContextMaxChars`、`interjectInstruction`、`debugPrompt`、`debugPromptMaxChars`

### 调频指南

#### 你的当前配置（非常活跃）

```json
"heatMessageThreshold": 2,      // 2条消息就算热 → 极易触发
"heatUniqueUsersThreshold": 1,   // 1个人说话就算热 → 自言自语也触发
"minGapMs": 5000,                // 5秒间隔 → 几乎无冷却
"maxRepliesPerWindow": 100,      // 每窗口100次 → 无上限
"randomChance": 1,               // 100%概率 → 必插
"activeWindowMs": 120000          // 2分钟窗口
```

这等于：**任何人说2条消息，接下来2分钟内每条消息都会触发回复**。

#### 推荐：适度活跃

```json
"heatMessageThreshold": 5,
"heatUniqueUsersThreshold": 2,
"minGapMs": 60000,
"maxRepliesPerWindow": 3,
"randomChance": 0.3,
"activeWindowMs": 300000
```

#### 推荐：低调潜水

```json
"heatMessageThreshold": 10,
"heatUniqueUsersThreshold": 3,
"minGapMs": 300000,
"maxRepliesPerWindow": 2,
"randomChance": 0.15,
"activeWindowMs": 600000
```

### 日志查看

- 实时：`openclaw logs --follow --plain | grep -E "activity prompt debug|activity interject|activity window"`
- 文件：`/tmp/openclaw/openclaw-YYYY-MM-DD.log`

## 长消息处理

当单次回复超过 `longMessageThreshold` 字符时，根据 `longMessageMode` 处理：

| 模式 | 说明 |
|------|------|
| normal | 正常分段发送（默认） |
| og_image | 将 Markdown 渲染为 HTML 并生成图片发送。需安装 `node-html-to-image`：`npm install node-html-to-image`。此模式下保留 Markdown 格式与代码高亮 |
| forward | 将各块消息先发给自己，再打包为合并转发发送。需 OneBot 实现支持 `send_group_forward_msg` / `send_private_forward_msg` |
