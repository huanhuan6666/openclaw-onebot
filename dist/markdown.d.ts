/**
 * Markdown 转纯文本（去除 **、#、` 等标记）
 * 用于将 AI 的 Markdown 回复渲染为 QQ 可读的纯文本
 */
export declare function markdownToPlain(text: string): string;
/** 将连续多个换行压缩为单个，减少 AI 输出中的多余空行 */
export declare function collapseDoubleNewlines(text: string): string;
