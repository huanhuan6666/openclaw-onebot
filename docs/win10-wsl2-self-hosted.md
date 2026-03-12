# Win10 + WSL2 + NapCat + OpenClaw 自部署教程

这份教程面向这样的场景：

- 你有一台自己的 Windows 10 电脑
- 你有一个闲置 QQ 号
- 你想把这个 QQ 号接到 OpenClaw
- 你不想依赖官方 QQ Bot 平台
- 你希望所有能力都由自己部署和控制

这套方案的核心架构是：

```text
Windows 10
  ├─ NapCat / QQ 客户端
  └─ 扫码登录闲置 QQ

WSL2 (Ubuntu)
  ├─ Node.js 22
  ├─ OpenClaw
  └─ openclaw-onebot 插件
```

也就是说：

- **Windows 负责 QQ 本体和 NapCat**
- **WSL2 负责 OpenClaw 和 agent**

---

## 1. 你需要准备什么

- 一台 Windows 10 电脑
- 已启用 WSL2
- 一个闲置 QQ 号
- 手机 QQ，用于扫码登录
- Node.js 22
- 足够稳定的网络环境

建议额外准备：

- 单独的 Fish Audio / OpenAI / 搜索等 API key
- 单独用于机器人的 QQ 号，不要直接用主号做实验

---

## 2. 为什么推荐“Windows + WSL2”

因为这条路线最符合真实使用环境：

- QQ / NapCat 在 Windows 上跑最自然
- OpenClaw、Node.js、脚本生态在 Linux 侧更舒服
- WSL2 可以把两边连起来，开发、调试、部署都比较方便

这比“全程只在 Windows 上手动跑一堆脚本”更稳，也比“试图把 QQ 客户端强行塞进 Linux”现实得多。

---

## 3. 安装 WSL2

如果你还没有 WSL2，先在 Windows PowerShell（管理员）里执行：

```powershell
wsl --install
```

装完后重启电脑。

建议安装 Ubuntu，例如：

```powershell
wsl --install -d Ubuntu
```

第一次启动 Ubuntu 时，创建一个 Linux 用户名和密码。

确认版本：

```powershell
wsl -l -v
```

确保看到类似：

```text
Ubuntu    Running    2
```

---

## 4. 在 WSL2 里安装 Node.js 22

进入 Ubuntu：

```bash
wsl
```

建议用 `nvm`：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node -v
npm -v
```

确保 `node -v` 是 `v22.x`。

---

## 5. 安装 OpenClaw

在 WSL2 里：

```bash
npm install -g openclaw
openclaw --version
```

然后初始化你的 OpenClaw 工作目录。

如果你已经有 OpenClaw 环境，可以直接复用。  
默认配置目录一般在：

```text
~/.openclaw
```

---

## 6. 安装本插件

推荐直接使用本仓库源码安装，因为这里介绍的是这份增强版 fork，而不是上游 npm 包。

```bash
git clone https://github.com/huanhuan6666/openclaw-onebot.git
cd openclaw-onebot
npm install
openclaw plugins link .
```

如果你只是想体验上游原版插件，再去看上游仓库：

```text
https://github.com/LSTM-Kirigaya/openclaw-onebot
```

如果你是从本地源码开发，也可以直接：

```bash
cd /path/to/openclaw-onebot
npm install
openclaw plugins link .
```

然后执行配置向导：

```bash
openclaw onebot setup
```

`openclaw onebot setup` 的最后也会顺带问你要不要安装这些预设人格。

如果你想直接装好仓库内置的 4 个预设人格，再执行：

```bash
openclaw onebot bootstrap-personas
```

这个命令会自动创建：

- `life-normal`
- `life-gentle`
- `life-laoge`
- `life-lezige`

以及它们各自的：

- `~/.openclaw/workspace-life-*`
- `~/.openclaw/agents/life-*/agent`

如果你当前已经有一个可用的 onebot 默认 agent，bootstrap 会尽量继承它的 workspace 结构、skills 和 tools。

---

## 7. 在 Windows 上安装 NapCat

NapCat 安装方式以官方文档为准：

- NapCat 项目页：https://github.com/NapNeko/NapCatQQ
- 开发文档：https://napcat.napneko.icu/develop/

通常你需要：

1. 在 Windows 上安装 NapCat
2. 启动它
3. 配好 OneBot WebSocket
4. 用闲置 QQ 号扫码登录

这里最关键的是：**NapCat 要成功上线，并且能提供 OneBot WebSocket 接口。**

---

## 8. 用闲置 QQ 号扫码登录

建议使用一个专门的闲置 QQ 号，而不是主号。

原因很简单：

- 真实账号路线天然有风控成本
- 你后面会频繁测试自动回复、群聊、语音、表情
- 闲置号更适合长期运行和试错

登录方式通常是：

1. 启动 NapCat / QQ
2. 出现二维码
3. 用手机 QQ 扫码
4. 登录成功

登录成功后，确认：

- 能正常在线
- OneBot 服务端启动成功
- NapCat 已监听 WebSocket 端口

---

## 9. 配置 NapCat 的 OneBot WebSocket

最推荐用 **forward-websocket**，也就是：

- OpenClaw onebot 插件主动连 NapCat

这样部署更简单。

你需要记住这些信息：

- NapCat 的 WebSocket 地址
- 端口
- access token（如果设置了）

例如：

```text
ws://127.0.0.1:3001
token=your_token
```

由于 OpenClaw 跑在 WSL2，NapCat 跑在 Windows，常见情况下：

- 可以直接尝试 `127.0.0.1`
- 如果不通，再改成 Windows 主机 IP

---

## 10. 在 OpenClaw 中配置 onebot channel

你可以用向导，也可以直接改 `~/.openclaw/openclaw.json`。

最小例子：

```json
{
  "channels": {
    "onebot": {
      "type": "forward-websocket",
      "host": "127.0.0.1",
      "port": 3001,
      "accessToken": "your_token",
      "requireMention": true
    }
  }
}
```

如果你不想每次群里都必须 `@` 才回复，可以调整：

```json
{
  "channels": {
    "onebot": {
      "requireMention": false
    }
  }
}
```

但一般不建议一上来就这么开。

---

## 11. 启动 OpenClaw gateway

在 WSL2 里：

```bash
openclaw gateway start
```

或如果你已经用 systemd / 用户服务托管，就按你的现有方式启动。

你需要确认：

- OpenClaw 正常启动
- onebot 插件已加载
- 可以连上 NapCat 的 WebSocket

如果连通，通常私聊或群里 @ 机器人时就能看到响应。

---

## 12. 验证最小链路

先做最小测试，不要一上来就配人格、语音、图片。

建议顺序：

1. QQ 私聊机器人，发送一句普通文本
2. 看它是否正常回复
3. 把机器人拉进群，在群里 `@机器人`
4. 看群聊回复是否正常

如果这一步都没通，不要继续往上加复杂能力。

---

## 13. 配置默认人格

建议不要只用一个共享 `lifeagent`，而是直接按人格拆成多个 `life-*` agent。

例如：

- `life-normal`
- `life-gentle`
- `life-laoge`
- `life-lezige`

然后在 `openclaw.json` 里把 onebot 默认绑定到一个主 persona：

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

这样新群、新私聊默认都是 `life-normal`。

---

## 14. 配置多人格

如果你已经运行过：

```bash
openclaw onebot bootstrap-personas
```

那么这一步通常已经自动完成了。你只需要检查 `bindings` 是否符合自己的预期。

只有当你想手工增删人格、或者自己设计新的 persona 时，才需要继续手改 `agents.list`。

当前这套方案推荐每个人格一个独立 agent / workspace。

例如：

```json
{
  "agents": {
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
  }
}
```

使用时：

```text
@bot /switch laoge
@bot /switch gentle
@bot 你有哪些人格
```

这样不同人格会维护独立记忆，不会互相污染。

---

## 15. 配置历史窗口，避免上下文过长

如果你担心同一个群连续聊太久导致上下文过长，可以在 `openclaw.json` 中限制 onebot 会话历史窗口：

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

含义：

- 群聊只保留最近 8 轮 user turn
- 私聊只保留最近 12 轮 user turn

这是很实用的配置，建议默认就开。

---

## 16. 配置语音功能

### 语音输入

当前插件已经支持 QQ 语音入站自动转写。  
也就是说，用户给机器人发 QQ 语音，OpenClaw 会先转文字，再让 agent 理解。

### 语音输出

开启方式：

```text
/voice on
/voice off
/voice inbound
/voice status
```

也支持自然语言：

```text
请用语音和我聊天
只在我发语音时用语音回复
恢复文字聊天
```

---

## 17. 配置 Fish Audio / Edge TTS

本插件支持 persona -> voice profile 映射。

配置文件：

```text
voice-profiles.json
```

实际密钥建议放在本地：

```text
voice-secrets.json
```

仓库中建议只保留：

```text
voice-secrets.example.json
```

一个简化示例：

```json
{
  "default": {
    "provider": "edge",
    "voice": "zh-CN-XiaoxiaoNeural"
  },
  "agents": {
    "life-normal": {
      "provider": "fishaudio",
      "referenceId": "your_fish_reference_id",
      "model": "s2-pro"
    }
  }
}
```

---

## 18. 群聊上下文是怎么工作的

这套插件不是简单地“只看当前一句话”。

它会区分两层上下文：

### 1. 长期 session

由 OpenClaw 自己维护，按 `agent + peer` 区分。

### 2. 群聊 recent context

机器人上次回复后，群里又说了什么，会先暂存在 onebot 插件里。  
后续一旦被 @ 或活跃触发，这些 recent 消息会一起送进 agent。

这就是为什么它更像“在群里接着聊”，而不是单轮问答。

---

## 19. 图片和语音为什么能理解

因为当前插件已经把图片 / 语音作为真正的媒体附件传进 OpenClaw，而不是只把 URL 塞进文本。

这意味着：

- 图片可以进入图片理解链
- 语音可以进入 STT 链
- 群聊里先发图、后追问，也能在 recent context 中补图片描述

---

## 20. QQ 原生生态支持

当前比较实用的几项：

- 群聊文本默认 reply 到触发消息
- QQ 黄脸支持 `[表情:344]` 这种占位自动渲染
- `mface` 最近缓存与重发
- QQ 语音 `record` 发送
- 私聊“正在输入中”

这也是这套方案比普通“文本通道插件”更像真实 QQ 用户的重要原因。

---

## 21. 常用指令

### 人格

```text
@bot /switch normal
@bot /switch laoge
@bot /switch gentle
@bot /switch default
@bot 你有哪些人格
```

### 语音

```text
/voice on
/voice off
/voice inbound
/voice status
```

### 自然语言控制

```text
切换成 laoge
切换成 gentle
请用语音和我聊天
只在我发语音时用语音回复
```

---

## 22. 常见问题

### Q1. 为什么推荐闲置 QQ 号？

因为这是**真实账号路线**，不是官方 Bot 路线。  
你后面会频繁测试自动回复、语音、群聊，最好不要直接拿主号做实验。

### Q2. NapCat 和 OpenClaw 哪个跑在 Windows，哪个跑在 WSL2？

推荐：

- Windows：NapCat / QQ
- WSL2：OpenClaw / openclaw-onebot

### Q3. 不用官方 QQ Bot 真的可以吗？

可以。  
这套方案本来就是为了绕开“必须申请官方 Bot 平台”的门槛，走真实账号 + NapCat 的路线。

### Q4. 这是不是就完全没有风控问题？

不是。  
真实账号路线始终要自己承担行为边界和风控成本，所以建议：

- 用闲置号
- 控制自动化频率
- 不要做明显异常行为

### Q5. 能发 QQ 空间 / 动态吗？

当前不行。  
NapCat 没有提供现成的“发动态 / 发说说”接口。

---

## 23. 故障排查

### OpenClaw 连不上 NapCat

优先检查：

- NapCat 是否正常在线
- WebSocket 地址和端口是否正确
- access token 是否正确
- WSL2 能否访问 Windows 上的端口

### 私聊能回，群聊不回

检查：

- 是否开启了 `requireMention`
- 是否真的 `@` 了机器人
- 群聊活跃参与配置是否开启

### 图片 / 语音理解失败

检查：

- 你的 OpenClaw 模型 / provider 是否支持多模态
- STT / 图片理解链是否可用
- 插件日志里有没有媒体理解错误

### 语音回复失败

检查：

- 当前是否真的开启了 `/voice on`
- `voice-profiles.json` 是否配置正确
- `voice-secrets.json` 是否只保存在本地且 key 可用

---

## 24. 推荐的发布方式

公开仓库时建议：

1. 只提交源码、README、教程、示例配置
2. 不提交本地日志
3. 不提交真实密钥
4. 不提交你的本地 `voice-secrets.json`
5. 如需演示，保留 `voice-secrets.example.json`

配套清单见：

- [发布到 GitHub 前检查清单](publish-checklist.md)

---

## 25. 结论

如果你有：

- 一台自己的 Windows 电脑
- WSL2
- 一个闲置 QQ 号

那么你就已经具备搭这套系统的全部基础条件。  
你不需要依赖官方 QQ Bot 平台，也不需要把核心能力托管给第三方。  
NapCat 负责 QQ，OpenClaw 负责 agent，本插件负责把它们接成一个真的能在 QQ 里长期运行的人格机器人。
