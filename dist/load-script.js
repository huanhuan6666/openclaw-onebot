/**
 * 动态加载用户脚本（支持 .js/.mjs/.ts/.mts）
 * .ts/.mts 依赖 tsx 运行时
 */
import { resolve } from "path";
import { pathToFileURL } from "url";
import { extname } from "path";
const TS_EXT = [".ts", ".mts"];
export async function loadScript(scriptPath, options) {
    const baseDir = options?.cwd?.trim() ? resolve(options.cwd) : process.cwd();
    const absPath = scriptPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(scriptPath)
        ? resolve(scriptPath.trim())
        : resolve(baseDir, scriptPath.trim());
    const ext = extname(absPath).toLowerCase();
    if (TS_EXT.includes(ext)) {
        try {
            await import("tsx/cjs");
        }
        catch {
            throw new Error("执行 .ts/.mts 脚本需要安装 tsx 依赖：npm install tsx");
        }
    }
    // 使用 pathToFileURL 确保 file:// URL 格式正确（Windows 反斜杠会转为正斜杠）
    const url = pathToFileURL(absPath).href;
    return (await import(url));
}
