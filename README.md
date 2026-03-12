<div align="center">

# openclaw-onebot

一个基于 **NapCat / OneBot + OpenClaw** 的 QQ 渠道插件。  
它不是单纯的“消息转发器”，而是把 **真实 QQ 号**、**多人格 agent**、**群聊上下文承接**、**语音输入输出**、**QQ 表情生态** 真正接成一个可长期运行的 QQ 角色。

[![npm version](https://img.shields.io/npm/v/@kirigaya/openclaw-onebot?style=flat-square)](https://www.npmjs.com/package/@kirigaya/openclaw-onebot)
[![GitHub stars](https://img.shields.io/github/stars/huanhuan6666/openclaw-onebot?style=flat-square)](https://github.com/huanhuan6666/openclaw-onebot)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square)](https://nodejs.org)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-9cf?style=flat-square)](https://openclaw.ai)

</div>

---

## 快速入口

- [Win10 + WSL2 + NapCat 自部署教程](docs/win10-wsl2-self-hosted.md)
- [多人格与 openclaw.json 配置说明](docs/personas-and-openclaw-config.md)
- [多人格 openclaw.json 示例](examples/openclaw.onebot-multi-persona.example.json)
- [发布到 GitHub 前检查清单](docs/publish-checklist.md)
- [语音密钥配置模板](voice-secrets.example.json)
- [内置 persona 模板](personas/README.md)

## Quick Start

默认你已经：

- 装好了 OpenClaw
- 装好了 NapCat
- 用闲置 QQ 号登录成功

最短上手路径：

```bash
openclaw plugins install @kirigaya/openclaw-onebot
openclaw onebot setup
openclaw onebot bootstrap-personas
openclaw gateway restart
```

然后：

1. 私聊你的 QQ 机器人发一句话
2. 或把它拉进群里后 `@` 它
3. 试试：

```text
@bot 你有哪些人格
@bot /switch laoge
@bot 请用语音和我聊天
```

这套默认会创建并启用：

- `life-normal`
- `life-gentle`
- `life-laoge`
- `life-lezige`

如果你只想先跑最小链路，不需要立刻手改 `openclaw.json`。  
只有当你要按群 / 私聊细分人格路由、改模型、改音色时，再去看：

- [多人格与 openclaw.json 配置说明](docs/personas-and-openclaw-config.md)

## 项目定位

这套插件选择的是 **NapCat + 真实 QQ 号** 路线，而不是官方 QQ Bot 路线。

这意味着它更适合做：

- 像真实群友一样参与群聊
- 在不同群 / 私聊中切换不同人格
- 使用 QQ 原生生态能力：reply、黄脸、收藏表情、语音、图片、文件
- 做“长期养成型”的 QQ agent，而不是单纯的客服式问答机器人

如果你想做的是：

- 一个挂在真实 QQ 号上的 AI 群友
- 支持多人格、语音、表情、群聊上下文承接
- 能在群里自然插话，而不只是被动 @ 回答

那这就是这套插件的目标场景。

## 核心特色

- **真实 QQ 号接入**
  基于 NapCat / OneBot，机器人本体就是一个真实 QQ 号，而不是官方 Bot 账号。

- **会话级多人格切换**
  每个人格对应独立 `life-*` agent，按群 / 私聊路由，且人格记忆彼此隔离。

- **自然语言切人格**
  除了 `/switch`，还支持“切换成 laoge”“你有哪些人格”这类确定性自然语言命令。

- **群聊 recent context 承接**
  机器人会记住“自己上次回复后，群里又聊了什么”，在后续追问、@ 或活跃触发时一起送进 agent。

- **群聊活跃参与**
  不必每条都 @ 机器人。满足活跃规则后，它可以像群成员一样顺着上文自然插话。

- **群聊 reply 式回复**
  普通文本群回复默认以“回复某条消息”的形式发送，显著减少多人并行聊天时的串台。

- **QQ 语音输入理解**
  收到 QQ 语音后自动进入 OpenClaw 的 STT 链，转成文本供 agent 理解。

- **QQ 语音回复**
  支持会话级 `/voice on|off|inbound|status`，可把 agent 的文本回复自动转成 QQ 语音。

- **人格专属音色**
  不同人格可绑定不同 Fish Audio / Edge TTS 音色。

- **语音语气标注**
  在真正发语音前，再额外调用一个小模型对最终回复做 `Fish Audio s2-pro` 风格标注。

- **图片理解**
  当前触发消息里的图片会作为真正媒体附件送进 OpenClaw，而不只是 URL 文本。

- **群聊 recent context 图片描述**
  群里先发图、后面再追问时，recent context 会自动补图片描述，帮助 agent 接上文。

- **QQ 黄脸自动渲染**
  文本中的 `[表情:微笑(14)]`、`[表情:344]` 会自动转成 QQ 标准黄脸，不需要专门调用工具。

- **收藏表情 / mface 支持**
  维护最近 `mface` 缓存，支持按 index 重发。

- **文件发送**
  支持上传并发送文件。

- **私聊正在输入中**
  私聊里可显示“正在输入中”状态。

## 功能概览

| 能力 | 状态 | 说明 |
|------|------|------|
| 私聊聊天 | 已支持 | 默认直接回复 |
| 群聊聊天 | 已支持 | 支持 @ 触发与活跃参与 |
| 群聊上下文承接 | 已支持 | recent context + 当前触发消息 |
| 多人格切换 | 已支持 | 按会话路由到不同 `life-*` agent |
| 人格独立记忆 | 已支持 | 不同人格维护独立 session |
| 自然语言切人格 | 已支持 | 不止 `/switch` |
| QQ 语音输入 | 已支持 | 自动 STT |
| QQ 语音输出 | 已支持 | 会话级 voice mode |
| persona 音色映射 | 已支持 | Fish Audio / Edge |
| 语音语气控制 | 已支持 | `s2-pro` + 二次标注 |
| 图片理解 | 已支持 | 当前消息图片作为媒体附件进入 OpenClaw |
| recent context 图片描述 | 已支持 | 群里先发图后追问可承接 |
| 黄脸自动渲染 | 已支持 | `[表情:...]` 自动转 QQ face |
| 收藏表情 mface | 已支持 | 缓存、列出、重发 |
| 文件发送 | 已支持 | 上传并发送文件 |
| 文件理解 | 未完成 | 当前仍偏文本占位 |
| 视频发送 | 未完成 | 暂无专门视频消息链 |
| QQ 空间 / 动态 | 未支持 | NapCat 未提供现成接口 |

## 整体架构

```text
QQ(真实账号)
   │
   ▼
NapCat / OneBot
   │  事件 / Action
   ▼
openclaw-onebot
   │
   ├─ 入站解析
   │   ├─ 文本 / @ / reply
   │   ├─ 图片 / 语音 / 表情 / 文件
   │   ├─ recent context
   │   └─ 人格 / 语音模式 / 群聊活跃规则
   │
   ├─ OpenClaw 上下文构造
   │   ├─ BodyForAgent
   │   ├─ MediaUrls / MediaPaths
   │   └─ session / route / peer binding
   │
   ▼
OpenClaw Core
   │
   ├─ LLM
   ├─ skills / tools
   ├─ STT / 图片理解
   └─ session/history
   │
   ▼
openclaw-onebot
   │
   ├─ 文本 reply
   ├─ 黄脸 / mface
   ├─ 图片 / 文件
   ├─ 语音 TTS
   └─ QQ record / reply / typing
   │
   ▼
QQ 对话
```

## 为什么选择 NapCat / 真实 QQ 号

和官方 QQ Bot 路线相比，这种方案的优点是：

- 更像真实用户在群里说话
- 可以直接使用真实账号已有的群、好友、头像、表情生态
- 群聊参与感更自然
- 更适合做长期养成型人格机器人

代价也很明确：

- 运维复杂度更高
- 受 NapCat / OneBot 接口能力边界约束
- 真实账号路线天然需要更谨慎地处理风控和行为边界

## 这个项目和“普通通道插件”的区别

这个插件已经不只是一个“把 OneBot 消息转给 OpenClaw”的简单适配层。

它还承担了下面这些交互层逻辑：

- 群聊 recent context 组织
- 活跃参与窗口管理
- persona 路由与自然语言切人格
- 语音模式控制
- persona -> voice profile 映射
- TTS 前后处理
- 黄脸占位解析
- recent `mface` 缓存
- QQ reply / record / typing / emoji-like 等交互细节

所以更准确的定位是：

> **QQ 交互层 + OpenClaw agent 通道层**

## 人格系统

当前人格系统的核心思想不是“反复覆盖同一份 `SOUL.md`”，而是：

- 每个人格一个独立 agent，例如 `life-normal`、`life-laoge`
- 每个人格一个独立 workspace
- 每个群 / 私聊都可以单独绑定到某个人格
- 切换人格时，本质上是修改当前 peer 的 agent 路由

这样带来的效果是：

- 人格 A 和人格 B 的长期记忆天然隔离
- 同一个群切回某个人格时，会恢复这个人格在该群之前的对话历史
- 不需要通过重写全局 `SOUL.md` 来模拟“换人格”

支持的交互方式：

```text
@bot /switch laoge
@bot /switch gentle
@bot 恢复默认人格
@bot 你有哪些人格
@bot 切换成 laoge
```

## 语音系统

语音系统分成两条链：

### 1. 语音输入

QQ `record` 消息进入 onebot 插件后，会转成媒体附件，再走 OpenClaw 的 STT 链。

最终 agent 看到的是：

- 当前消息正文
- `<media:audio>`
- 转写后的 transcript

### 2. 语音输出

当当前会话开启 voice mode 时：

1. agent 先正常输出文本
2. 文本进入 TTS 前处理
3. 可按人格选择不同 voice profile
4. 若使用 Fish Audio `s2-pro`，可先经一个小模型做语气标注
5. 最终转成 QQ 语音 `record` 发回去

支持的会话级命令：

```text
/voice on
/voice off
/voice inbound
/voice status
```

也支持自然语言形式：

```text
请用语音和我聊天
只在我发语音时用语音回复
恢复文字聊天
别发语音了
```

### 语音配置

人格音色映射文件：

- [voice-profiles.json](voice-profiles.json)

这里可以配置：

- provider
- model
- referenceId / voice
- annotation provider/model
- 最大 cue 数量
- 温度等参数

## QQ 原生生态适配

### 文本 reply

群文本回复默认使用 reply 形式挂到触发消息下，减少串台。

### 黄脸

支持在文本中直接写：

```text
[表情:344]
[表情:微笑(14)]
[表情:大怨种(344)]
```

发送时会自动渲染成 QQ 标准黄脸。  
映射表来自 [face-map.json](face-map.json)。

### 收藏表情 / mface

支持：

- 自动缓存最近收到的收藏表情
- 列出最近缓存
- 通过工具按 index 重发

## 安装

```bash
openclaw plugins install @kirigaya/openclaw-onebot
openclaw onebot setup
openclaw onebot bootstrap-personas
```

OneBot 服务端推荐使用 NapCat。

如果你只想快速体验，推荐按这个顺序：

1. `openclaw plugins install @kirigaya/openclaw-onebot`
2. `openclaw onebot setup`
3. `openclaw onebot bootstrap-personas`
4. `openclaw gateway restart`
5. 用闲置 QQ 号私聊或群聊 `@` 机器人测试

其中：

- `setup` 负责 onebot 连接参数
- `setup` 结束时也会顺带询问是否安装预设人格；如果当时跳过，后面还能单独运行 `bootstrap-personas`
- `bootstrap-personas` 负责创建内置的 `life-normal / life-gentle / life-laoge / life-lezige`
- bootstrap 会优先继承你当前 onebot 默认 agent 的 workspace 结构、skills 和 tools
- 如果你是纯新环境，它也会生成最小可用的 `life-*` 目录骨架

参考：

- [NapCat](https://github.com/NapNeko/NapCatQQ)
- [NapCat 文档](https://napcat.napneko.icu/develop/)

## 连接模式

| 类型 | 说明 |
|------|------|
| `forward-websocket` | 插件主动连接 OneBot |
| `backward-websocket` | 插件作为服务端，OneBot 反连 |

## 最小使用流程

1. 安装并配置 NapCat
2. 安装插件并完成 `openclaw onebot setup`
3. 运行 `openclaw onebot bootstrap-personas`
4. 重启 gateway
5. 使用 QQ 私聊或群聊测试
6. 如需更细的群/私聊人格路由，再手工调整 `bindings`

## 典型配置思路

### 1. 默认 onebot 人格

在 `openclaw.json` 中把 onebot 默认绑定到你的主 persona agent，例如：

```json
{
  "bindings": [
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

### 2. 让不同群 / 私聊使用不同人格

```json
{
  "bindings": [
    {
      "agentId": "life-laoge",
      "match": {
        "channel": "onebot",
        "accountId": "default",
        "peer": { "kind": "group", "id": "514242535" }
      }
    }
  ]
}
```

### 3. onebot 历史窗口

OpenClaw 自带 `historyLimit / dmHistoryLimit`。  
你可以限制 onebot 会话送给模型的历史轮数，避免上下文过大：

```json
{
  "channels": {
    "onebot": {
      "historyLimit": 8,
      "dmHistoryLimit": 12
    }
  }
}
```

## 当前已做的重点增强

可以把这个项目理解成对传统 OneBot 插件的这些增强：

- 群聊上下文从“当前一句话”升级到“recent context + 当前触发”
- `BodyForAgent` 明确接入，避免 recent context 丢失
- 图片 / 语音入站真正进入 OpenClaw 多模态链
- 群聊未处理图片也能在后续追问时补描述
- persona 从“改一份 SOUL”升级成“按会话切独立 agent”
- voice mode 成为会话级能力
- QQ 语音输入输出完整打通
- 文本中的 QQ 黄脸支持自动渲染
- 收藏表情 / mface 具备最近缓存和重发能力

## 当前边界

下面这些暂时不建议在 README 里夸大：

- **文件理解**：当前仍未完整接入
- **视频消息发送**：尚无专门实现
- **QQ 空间 / 动态**：NapCat 目前无现成 API
- **所有行为都热更新**：并非所有运行期状态都能无缝热更新
- **完全无风控成本**：真实 QQ 号路线本身就需要谨慎运营

## 路线图

接下来值得继续做的方向：

- 文件理解
- 视频消息链
- 更完整的人格创建 / 导出 / 迁移工具
- 群聊回复决策器
- 配置面板 / 观测面板
- QQ 状态 / 头像 / 个签控制

## 开发说明

本项目目前包含：

- OneBot 插件层逻辑
- 多人格路由逻辑
- 语音交互层逻辑
- QQ 生态适配逻辑

但不包含 NapCat 本体修改。  
也就是说：

- **NapCat 提供底层 QQ 能力**
- **OpenClaw 提供 agent / skill / LLM 能力**
- **本项目负责把两者接成可用的 QQ 人格 agent**

## 安全提示

请不要把运行期文件提交到公开仓库，例如：

- `voice-secrets.json`
- `history-debug.log`
- `prompt-debug/`
- `voice-debug/`
- `voice-state.json`

这些文件通常包含：

- API 密钥
- 调试日志
- prompt 观测数据
- 会话级运行状态

另外，语音相关密钥请只保存在本地：

- 本地运行文件：`voice-secrets.json`
- 仓库示例模板：`voice-secrets.example.json`

## 参考

- [OneBot 11](https://github.com/botuniverse/onebot-11)
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [NapCat 开发文档](https://napcat.napneko.icu/develop/)
- [OpenClaw](https://openclaw.ai)

## License

MIT
