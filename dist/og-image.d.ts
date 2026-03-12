/**
 * Markdown 转 OG 图片
 * 依赖可选的 node-html-to-image（需安装：npm install node-html-to-image）
 */
export declare function markdownToImage(md: string): Promise<string | null>;
