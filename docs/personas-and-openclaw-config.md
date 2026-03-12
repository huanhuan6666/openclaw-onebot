# 多人格与 `openclaw.json` 配置说明

这一页专门解释两件事：

1. 这个项目里“`life-*` 人格”到底应该怎么组织
2. `openclaw.json` 里和 onebot / persona 相关的配置分别是什么意思

如果你看完 README 后最大的疑问是：

- `lifeagent` 和 `life-normal` 到底是什么关系？
- 那么多 `SOUL.md` 放哪？
- 用户 clone 仓库后，怎么把这些人格真正装起来？
- `bindings`、`agents.list`、`channels.onebot` 各自控制什么？

那就看这页。

---

## 1. 先说结论

当前推荐的结构不是：

- 只有一个 `lifeagent`
- 然后不停替换它的 `SOUL.md`

而是：

- 每个人格一个独立 agent
- 每个人格一个独立 workspace
- 每个群 / 私聊通过 binding 路由到对应人格

也就是这种结构：

```text
~/.openclaw/
  agents/
    life-normal/
    life-gentle/
    life-laoge/
    life-lezige/
  workspace-life-normal/
    SOUL.md
  workspace-life-gentle/
    SOUL.md
  workspace-life-laoge/
    SOUL.md
  workspace-life-lezige/
    SOUL.md
  openclaw.json
```

这套结构的意义是：

- `life-normal` 只维护 `normal` 自己的记忆
- `life-laoge` 只维护 `laoge` 自己的记忆
- 同一个群切回某个人格时，会接上这个人格之前在该群的历史
- 不同人格之间不会共享 transcript

---

## 2. `lifeagent` 现在是什么地位

如果你以前用过旧版结构，可能会看到一个：

```text
lifeagent
```

它通常只是历史遗留或默认 agent。

当前更推荐的做法是：

- 保留 `lifeagent` 作为旧兼容或基础模板
- 实际运行主要使用：
  - `life-normal`
  - `life-gentle`
  - `life-laoge`
  - `life-lezige`

也就是说，**对最终用户来说，重要的是 `life-*` 这些 persona agents，而不是 `lifeagent` 本身。**

---

## 3. 仓库里需要包含什么

为了让别人也能安装、配置和跑起来，repo 里至少应该有三类东西：

### 1. persona 模板

也就是每个人格对应的 `SOUL.md` 模板。

本仓库已经提供：

- [SOUL_normal.md](../personas/SOUL_normal.md)
- [SOUL_gentle.md](../personas/SOUL_gentle.md)
- [SOUL_laoge.md](../personas/SOUL_laoge.md)
- [SOUL_lezige.md](../personas/SOUL_lezige.md)

### 2. 配置说明

也就是这页文档，以及一个可复制的 `openclaw.json` 片段。

### 3. 安装步骤

推荐优先走插件自带的一键初始化：

```bash
openclaw onebot bootstrap-personas
```

这个命令会自动：

- 创建 `life-normal / life-gentle / life-laoge / life-lezige`
- 创建对应的 `workspace-life-*`
- 把仓库里的 persona 模板复制成各自的 `SOUL.md`
- 创建 `~/.openclaw/agents/life-*/agent`
- 尽量继承你当前 onebot 默认 agent 的 workspace 结构、skills 和 tools
- 可选把 onebot 默认绑定切到 `life-normal`

---

## 4. 用户如何“安装”这些人格

默认推荐：

```bash
openclaw onebot bootstrap-personas
```

如果你只是想快速体验，运行完这个命令后再重启 gateway 就够了。

只有当你想完全手工控制目录结构时，才需要走下面这套手动方式。

### 高级用法：手动复制

例如你要安装 `life-laoge`：

### 第一步：创建 workspace

```bash
mkdir -p ~/.openclaw/workspace-life-laoge
```

### 第二步：复制 persona 模板

把仓库里的：

- [SOUL_laoge.md](../personas/SOUL_laoge.md)

复制成：

```text
~/.openclaw/workspace-life-laoge/SOUL.md
```

### 第三步：创建 agentDir

```bash
mkdir -p ~/.openclaw/agents/life-laoge/agent
```

### 第四步：在 `openclaw.json` 里加这个 agent

```json
{
  "agents": {
    "list": [
      {
        "id": "life-laoge",
        "workspace": "/home/you/.openclaw/workspace-life-laoge",
        "agentDir": "/home/you/.openclaw/agents/life-laoge/agent",
        "model": "openai-hk/gemini-3-flash-preview"
      }
    ]
  }
}
```

同理，`normal / gentle / lezige` 也是一样。

---

## 5. 推荐的 persona 目录结构

建议用户按下面的目录结构组织：

```text
~/.openclaw/
  workspace-life-normal/
    SOUL.md
  workspace-life-gentle/
    SOUL.md
  workspace-life-laoge/
    SOUL.md
  workspace-life-lezige/
    SOUL.md
```

而不是都塞进一个 `workspace-life` 再反复替换。

这样更符合当前 onebot 插件的路由设计。

---

## 6. `openclaw.json` 的核心结构

和这个项目最相关的主要有四块：

- `channels.onebot`
- `agents.defaults`
- `agents.list`
- `bindings`

下面逐个解释。

---

## 7. `channels.onebot`

这一段控制的是：

- onebot 如何连接 NapCat
- 群聊是否必须 `@`
- 历史窗口大小
- 群聊活跃参与规则

示例：

```json
{
  "channels": {
    "onebot": {
      "type": "forward-websocket",
      "host": "172.30.16.1",
      "port": 3001,
      "accessToken": "your_onebot_token",
      "enabled": true,
      "requireMention": true,
      "historyLimit": 8,
      "dmHistoryLimit": 12,
      "renderMarkdownToPlain": false,
      "longMessageMode": "normal",
      "longMessageThreshold": 300,
      "activityInterject": {
        "enabled": true,
        "groupIds": [514242535, 676266126],
        "mentionActivates": true,
        "heatActivates": true,
        "activeWindowMs": 120000,
        "heatWindowMs": 30000,
        "heatMessageThreshold": 4,
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

### 这些字段分别是什么意思

- `type`
  OneBot 连接方式。通常用 `forward-websocket`

- `host` / `port`
  NapCat 的 WebSocket 地址

- `accessToken`
  NapCat 的 OneBot token

- `requireMention`
  群聊是否必须 `@机器人` 才回复

- `historyLimit`
  群聊最多保留多少轮 user turn

- `dmHistoryLimit`
  私聊最多保留多少轮 user turn

- `activityInterject`
  群聊活跃参与的规则

---

## 8. `agents.defaults`

这一段是所有 agent 的默认配置。

例如：

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai-codex/gpt-5.3-codex"
      },
      "workspace": "/home/you/.openclaw/workspace",
      "compaction": {
        "mode": "safeguard"
      },
      "maxConcurrent": 4
    }
  }
}
```

这里要注意的是：

- `agents.defaults` 是全局默认值
- 具体到 `life-*`，通常会在 `agents.list` 中覆盖自己的 `model` 和 `workspace`

所以对多 persona 系统来说，`defaults` 更多是一个兜底。

---

## 9. `agents.list`

这是最关键的一段。  
它真正定义了有哪些人格 agent。

示例：

```json
{
  "agents": {
    "list": [
      {
        "id": "life-normal",
        "workspace": "/home/you/.openclaw/workspace-life-normal",
        "agentDir": "/home/you/.openclaw/agents/life-normal/agent",
        "model": "openai-hk/gemini-3-flash-preview",
        "tools": {
          "allow": [
            "group:fs",
            "group:runtime",
            "web_fetch",
            "pdf",
            "session_status",
            "onebot_send_image",
            "onebot_upload_file",
            "onebot_get_group_msg_history",
            "onebot_delete_msg",
            "onebot_send_mface"
          ]
        }
      }
    ]
  }
}
```

### 你真正需要关心的字段

- `id`
  agent 的唯一标识，例如 `life-normal`

- `workspace`
  这个人格对应的 workspace，里面的 `SOUL.md` 决定人格风格

- `agentDir`
  这个人格自己的 agent 目录

- `model`
  这个人格实际使用的模型

- `skills`
  给这个人格开放哪些 skill

- `tools.allow`
  给这个人格开放哪些工具

---

## 10. `bindings`

这段决定：

- 哪个群 / 私聊会被路由到哪个人格

例如：

```json
{
  "bindings": [
    {
      "agentId": "life-gentle",
      "match": {
        "channel": "onebot",
        "accountId": "default",
        "peer": {
          "kind": "group",
          "id": "514242535"
        }
      }
    },
    {
      "agentId": "life-normal",
      "match": {
        "channel": "onebot",
        "accountId": "default"
      }
    }
  ]
}
```

这表示：

- `514242535` 这个群固定走 `life-gentle`
- 其他 onebot 会话默认走 `life-normal`

### 理解优先级

一般可以理解成：

- 更具体的 `peer` 绑定优先
- 最后再落到 onebot 的默认绑定

所以建议永远保留一条：

```json
{
  "agentId": "life-normal",
  "match": {
    "channel": "onebot",
    "accountId": "default"
  }
}
```

作为兜底。

---

## 11. 为什么切人格会切换会话

因为 session key 本身就包含 `agentId`。

也就是说：

- `life-normal + group:514242535`
- `life-laoge + group:514242535`

会是两条不同的会话历史。

这正是你要的效果：

- 人格和人格之间的记忆不一样
- 同一个群切回某个人格时，能恢复它自己的历史

---

## 12. `voice-profiles.json` 怎么和人格对应

多 persona 语音不是在 `openclaw.json` 里配的，而是在：

- [voice-profiles.json](../voice-profiles.json)

例如：

```json
{
  "agents": {
    "life-normal": {
      "provider": "fishaudio",
      "referenceId": "your_reference_id",
      "model": "s2-pro"
    },
    "life-laoge": {
      "provider": "fishaudio",
      "referenceId": "your_reference_id",
      "model": "s2-pro"
    }
  }
}
```

这里的 key 必须和 `agents.list[].id` 对应上。

---

## 13. 一个最小可运行的多人格配置示例

下面这段可以作为参考：

```json
{
  "channels": {
    "onebot": {
      "type": "forward-websocket",
      "host": "172.30.16.1",
      "port": 3001,
      "accessToken": "your_token",
      "enabled": true,
      "requireMention": true,
      "historyLimit": 8,
      "dmHistoryLimit": 12
    }
  },
  "agents": {
    "defaults": {
      "compaction": {
        "mode": "safeguard"
      }
    },
    "list": [
      {
        "id": "life-normal",
        "workspace": "/home/you/.openclaw/workspace-life-normal",
        "agentDir": "/home/you/.openclaw/agents/life-normal/agent",
        "model": "openai-hk/gemini-3-flash-preview"
      },
      {
        "id": "life-laoge",
        "workspace": "/home/you/.openclaw/workspace-life-laoge",
        "agentDir": "/home/you/.openclaw/agents/life-laoge/agent",
        "model": "openai-hk/gemini-3-flash-preview"
      }
    ]
  },
  "bindings": [
    {
      "agentId": "life-laoge",
      "match": {
        "channel": "onebot",
        "accountId": "default",
        "peer": { "kind": "group", "id": "514242535" }
      }
    },
    {
      "agentId": "life-normal",
      "match": {
        "channel": "onebot",
        "accountId": "default"
      }
    }
  ]
}
```

---

## 14. 推荐的安装顺序

给新用户最好的顺序是：

1. 先把 onebot 通道跑通
2. 运行 `openclaw onebot bootstrap-personas`
3. 确认私聊 / 群聊都能正常回复
4. 再按需要调整 `bindings`
5. 最后再配语音音色、活跃参与参数和其他 skills

不要一上来就把所有 persona、voice、skills 全部堆进去。

---

## 15. 这页文档想解决什么问题

一句话说：

> **让别人 clone 这个仓库以后，不需要知道你本机 `~/.openclaw` 的历史结构，也能自己把 `life-*` 多人格跑起来。**

这也是为什么 repo 里不仅要有 onebot 插件源码，还要有：

- persona 模板
- 配置解释
- 安装路径说明
- 一个可复制的 `openclaw.json` 示例
