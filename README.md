<div align="center">

# openclaw-onebot（增强版）

基于 [LSTM-Kirigaya/openclaw-onebot](https://github.com/LSTM-Kirigaya/openclaw-onebot) 的二次开发增强版。

上游项目提供了完整的 OneBot v11 / QQ 接入能力（连接、消息收发、配置向导等）。
**本仓库在此基础上增加了以下功能**：

[![GitHub stars](https://img.shields.io/github/stars/huanhuan6666/openclaw-onebot?style=flat-square)](https://github.com/huanhuan6666/openclaw-onebot)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square)](https://nodejs.org)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-9cf?style=flat-square)](https://openclaw.ai)

</div>

---

## 我们增加了什么

| 增强方向 | 具体内容 |
|---------|---------|
| **多人格系统** | 4 个预设人格 (`life-normal / gentle / laoge / lezige`)，每个独立 agent + workspace + session，按群/私聊路由，记忆隔离 |
| **一键人格部署** | `openclaw onebot bootstrap-personas` 自动创建 workspace、复制 SOUL.md、写入 openclaw.json |
| **自然语言切人格** | 除 `/switch laoge` 外，支持 "切换成老哥" "你有哪些人格" 等中文意图识别 |
| **语音聊天** | 会话级 `/voice on\|off\|inbound`，支持 4 种 TTS 引擎 (Edge / OpenAI / ElevenLabs / Fish Audio) |
| **人格专属音色** | 不同人格绑定不同 voice profile，Fish Audio s2-pro 支持 LLM 自动语气标注 |
| **群聊上下文承接** | 50 条 pending buffer，bot 上次回复后群里聊了什么都会带给 agent |
| **群聊活跃参与** | 热度检测自动插话，不必每条都 @ |
| **QQ 表情生态** | 黄脸自动渲染、mface 收藏表情缓存与重发、emoji reaction |
| **图片上下文** | 群聊先发图后追问时，recent context 自动补图片描述 |
| **私聊输入状态** | 私聊显示"正在输入中" |

> 如果你只需要基础的 OneBot 接入能力，请直接使用[上游项目](https://github.com/LSTM-Kirigaya/openclaw-onebot)。

---

## Quick Start

### 前置条件

1. **OpenClaw 已安装** — 参考 [OpenClaw 官网](https://openclaw.ai)
2. **NapCat 已安装并登录** — 参考 [NapCat 文档](https://napcat.napneko.icu/develop/)，用闲置 QQ 号登录

### 安装与配置

```bash
# 1. 克隆本仓库
git clone https://github.com/huanhuan6666/openclaw-onebot.git
cd openclaw-onebot
npm install

# 2. 注册插件
openclaw plugins link .

# 3. 配置连接 + 部署人格（交互式向导，setup 结束时会询问是否一并部署人格）
openclaw onebot setup

# 4. 启动
openclaw gateway restart
```

> `setup` 结束时会问"是否安装预设人格"。如果当时跳过了，后续可单独运行：
> ```bash
> openclaw onebot bootstrap-personas
> ```

### 验证

```text
私聊机器人：你好
群聊 @机器人：你有哪些人格
群聊 @机器人：/switch laoge
群聊 @机器人：请用语音和我聊天
```

---

## 人格系统

`bootstrap-personas` 会自动创建 4 个人格：

| 人格 | Agent ID | 风格 |
|------|----------|------|
| 安 | `life-normal` | 温暖日常，网络用语自然 |
| Gentle | `life-gentle` | 理性冷静，标准普通话 |
| 老哥 | `life-laoge` | 孙吧/康吧风格，犀利毒舌 |
| 乐子哥 | `life-lezige` | 活跃气氛，meme 能量 |

每个人格 = 独立 workspace + 独立 session + 独立 SOUL.md。切换人格不会丢失任何一方的对话记忆。

### 按群/私聊指定人格

在 `openclaw.json` 的 `bindings` 中配置：

```json
{
  "bindings": [
    {
      "agentId": "life-normal",
      "match": { "channel": "onebot", "accountId": "default" }
    },
    {
      "agentId": "life-laoge",
      "match": { "channel": "onebot", "accountId": "default", "peer": { "kind": "group", "id": "你的群号" } }
    }
  ]
}
```

完整示例见 [examples/openclaw.onebot-multi-persona.example.json](examples/openclaw.onebot-multi-persona.example.json)。

---

## 语音配置

语音功能需要额外配置音色和 API 密钥：

- **音色映射**：[voice-profiles.json](voice-profiles.json) — 每个 `life-*` agent 绑定不同 TTS voice
- **API 密钥**：复制 `voice-secrets.example.json` → `voice-secrets.json`，填入你的 Fish Audio API Key

默认 fallback 为免费的 Edge TTS（无需密钥）。

---

## 连接模式

| 类型 | 说明 |
|------|------|
| `forward-websocket` | 插件主动连接 NapCat |
| `backward-websocket` | NapCat 反连插件 |

由 `openclaw onebot setup` 向导配置，也可在 `openclaw.json` 的 `channels.onebot` 中手动修改。

---

## 文档

| 文档 | 内容 |
|------|------|
| [多人格配置详解](docs/personas-and-openclaw-config.md) | agents、bindings、activityInterject 完整说明 |
| [Win10 + WSL2 自部署](docs/win10-wsl2-self-hosted.md) | 从零开始的完整部署教程 |
| [人格模板说明](personas/README.md) | 4 个 SOUL.md 的设计思路 |
| [配置示例](examples/openclaw.onebot-multi-persona.example.json) | 可直接参考的 openclaw.json |
| [发布检查清单](docs/publish-checklist.md) | 开源前的安全检查 |

---

## 架构

```
QQ 真实账号 ←→ NapCat / OneBot ←→ openclaw-onebot ←→ OpenClaw Core (LLM/Skills/Tools)
                                        │
                                        ├─ 人格路由 (life-normal / gentle / laoge / lezige)
                                        ├─ 群聊 pending buffer + 活跃参与
                                        ├─ 语音 TTS (Edge / OpenAI / ElevenLabs / Fish Audio)
                                        └─ QQ 生态 (黄脸 / mface / reply / typing)
```

---

## 已知限制

- 文件理解尚未完整接入
- 视频消息发送暂无专门实现
- 真实 QQ 号路线需注意风控，建议用闲置号

---

## 安全提示

以下文件包含密钥或运行时数据，**不要提交到公开仓库**：

`voice-secrets.json` · `history-debug.log` · `prompt-debug/` · `voice-debug/` · `voice-state.json`

---

## 参考

- 上游项目：[LSTM-Kirigaya/openclaw-onebot](https://github.com/LSTM-Kirigaya/openclaw-onebot)
- [OneBot 11 协议](https://github.com/botuniverse/onebot-11) · [NapCatQQ](https://github.com/NapNeko/NapCatQQ) · [OpenClaw](https://openclaw.ai)

## License

MIT
