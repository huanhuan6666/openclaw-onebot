# 发布到 GitHub 前检查清单

这份清单是给准备把仓库公开的人用的。

## 1. 不要提交这些文件

- `voice-secrets.json`
- `history-debug.log`
- `prompt-debug/`
- `voice-debug/`
- `voice-state.json`
- `node_modules/`

这些文件已经被 `.gitignore` 排除，但你仍然应该在提交前手动确认一遍。

## 2. 只保留示例，不保留真实密钥

推荐做法：

- 本地使用：`voice-secrets.json`
- 仓库公开：`voice-secrets.example.json`

不要把真实 key 写进 README、示例配置或截图。

## 3. 检查 README 和文档

确认文档中没有：

- 真实 token
- 真实 API key
- 你的 Windows 用户名 / 本地绝对路径
- 你的真实 QQ 号
- 私聊 / 群聊截图中的敏感信息

## 4. 检查配置文件

如果你要公开 `voice-profiles.json`，建议确认这些字段是否适合公开：

- `referenceId`
- `voice`
- `provider`
- `model`

它们通常不是密钥，但可能属于你的个人配置。

## 5. 检查日志和调试输出

特别留意：

- prompt 观测日志
- voice 调试日志
- 历史消息日志

这些内容很容易暴露：

- 群聊内容
- 私聊内容
- persona 配置
- prompt 结构

## 6. 发布前建议做一次全文搜索

可以搜索这些关键词：

```text
apiKey
accessToken
secret
Bearer
Authorization
sk-
AIza
```

## 7. 最终建议

公开仓库时，尽量保证：

- 代码是通的
- 文档是完整的
- 示例是可复现的
- 密钥和私有日志是完全清理掉的
