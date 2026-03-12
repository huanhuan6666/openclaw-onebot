# Persona Templates

这个目录存放的是可直接复用的 persona `SOUL.md` 模板。

推荐优先用插件自带的一键初始化：

```bash
openclaw onebot bootstrap-personas
```

这个命令会自动把这些模板安装到你的 `~/.openclaw/workspace-life-*`。

如果你想完全手工控制目录结构，再用下面这套手动方式：

1. 选择一个 persona 模板
2. 复制到你自己的 OpenClaw workspace
3. 文件名改成 `SOUL.md`
4. 在 `openclaw.json` 里把这个 workspace 挂到一个新的 `life-*` agent

例如：

```bash
mkdir -p ~/.openclaw/workspace-life-laoge
cp personas/SOUL_laoge.md ~/.openclaw/workspace-life-laoge/SOUL.md
mkdir -p ~/.openclaw/agents/life-laoge/agent
```

然后在 `openclaw.json` 中添加：

```json
{
  "id": "life-laoge",
  "workspace": "/home/you/.openclaw/workspace-life-laoge",
  "agentDir": "/home/you/.openclaw/agents/life-laoge/agent",
  "model": "openai-hk/gemini-3-flash-preview"
}
```

当前提供的模板：

- [SOUL_normal.md](SOUL_normal.md)
- [SOUL_gentle.md](SOUL_gentle.md)
- [SOUL_laoge.md](SOUL_laoge.md)
- [SOUL_lezige.md](SOUL_lezige.md)
