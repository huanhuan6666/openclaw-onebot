/**
 * 动态加载用户脚本（支持 .js/.mjs/.ts/.mts）
 * .ts/.mts 依赖 tsx 运行时
 */
export interface LoadScriptOptions {
    /** 脚本执行时的 CWD 绝对路径，用于解析相对路径及脚本内 process.cwd() */
    cwd?: string;
}
export declare function loadScript(scriptPath: string, options?: LoadScriptOptions): Promise<Record<string, unknown>>;
