/**
 * Markdown 转 HTML（保留格式，含代码高亮）
 * 用于 OG 图片模式下的 Markdown 渲染
 */
import { marked } from "marked";
import hljs from "highlight.js";
const HIGHLIGHT_CSS = `
.hljs{display:block;overflow-x:auto;padding:1em;background:#1e1e1e;color:#d4d4d4;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:13px;line-height:1.5}
.hljs-keyword{color:#569cd6}
.hljs-string{color:#ce9178}
.hljs-number{color:#b5cea8}
.hljs-comment{color:#6a9955}
.hljs-function{color:#dcdcaa}
.hljs-title{color:#4ec9b0}
.hljs-params{color:#9cdcfe}
.hljs-built_in{color:#4ec9b0}
.hljs-class{color:#4ec9b0}
.hljs-variable{color:#9cdcfe}
.hljs-attr{color:#9cdcfe}
.hljs-tag{color:#569cd6}
.hljs-name{color:#569cd6}
.hljs-meta{color:#808080}
`;
function highlightCode(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
        try {
            return hljs.highlight(code, { language: lang }).value;
        }
        catch {
            return hljs.highlightAuto(code).value;
        }
    }
    return hljs.highlightAuto(code).value;
}
marked.use({
    breaks: true,
    gfm: true,
    renderer: {
        code({ text, lang }) {
            const escaped = highlightCode(text, lang);
            return `<pre><code class="hljs language-${lang || ""}">${escaped}</code></pre>`;
        },
    },
});
const WRAPPER_STYLE = `
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.6;color:#24292e;background:#fff;padding:24px;max-width:800px}
h1,h2,h3,h4,h5,h6{margin:16px 0 8px;font-weight:600;line-height:1.25}
h1{font-size:1.5em}
h2{font-size:1.3em}
h3{font-size:1.15em}
p{margin:8px 0}
ul,ol{margin:8px 0;padding-left:24px}
li{margin:4px 0}
code{background:#f6f8fa;padding:2px 6px;border-radius:4px;font-size:0.9em;font-family:Consolas,Monaco,monospace}
pre{margin:12px 0;overflow-x:auto}
pre code{background:transparent;padding:0}
blockquote{border-left:4px solid #dfe2e5;padding-left:16px;margin:8px 0;color:#6a737d}
a{color:#0366d6;text-decoration:none}
a:hover{text-decoration:underline}
table{border-collapse:collapse;margin:12px 0}
th,td{border:1px solid #dfe2e5;padding:8px 12px;text-align:left}
th{background:#f6f8fa;font-weight:600}
${HIGHLIGHT_CSS}
</style>
`;
export function markdownToHtml(md) {
    if (!md || typeof md !== "string")
        return "";
    return marked.parse(md, { async: false });
}
export function getMarkdownStyles() {
    return WRAPPER_STYLE;
}
