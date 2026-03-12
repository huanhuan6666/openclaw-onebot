/**
 * Markdown 转纯文本（去除 **、#、` 等标记）
 * 用于将 AI 的 Markdown 回复渲染为 QQ 可读的纯文本
 */
export function markdownToPlain(text) {
    if (!text || typeof text !== "string")
        return "";
    let s = text;
    // 代码块 ```...```
    s = s.replace(/```[\s\S]*?```/g, (m) => {
        const inner = m.slice(3, -3).trim();
        return inner ? `${inner}\n` : "";
    });
    // 行内代码 `...`
    s = s.replace(/`([^`]+)`/g, "$1");
    // 粗体 **...** 或 __...__
    s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
    s = s.replace(/__([^_]+)__/g, "$1");
    // 斜体 *...* 或 _..._（在粗体之后处理）
    s = s.replace(/\*([^*]+)\*/g, "$1");
    s = s.replace(/_([^_]+)_/g, "$1");
    // 标题 # ## ### ...
    s = s.replace(/^#{1,6}\s+/gm, "");
    // 链接 [text](url) -> text
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    // 图片 ![alt](url) -> alt 或 [图片]
    s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => (alt?.trim() ? alt : "[图片]"));
    // 删除线 ~~...~~
    s = s.replace(/~~([^~]+)~~/g, "$1");
    // 引用 > 行首
    s = s.replace(/^>\s*/gm, "");
    // 无序列表 - * +
    s = s.replace(/^[\s]*[-*+]\s+/gm, "");
    // 有序列表 1. 2.
    s = s.replace(/^[\s]*\d+\.\s+/gm, "");
    return s.trim();
}
/** 将连续多个换行压缩为单个，减少 AI 输出中的多余空行 */
export function collapseDoubleNewlines(text) {
    if (!text || typeof text !== "string")
        return "";
    return text.replace(/\n{2,}/g, "\n");
}
