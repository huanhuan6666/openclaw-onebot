/**
 * 内置定时任务调度器
 * 根据配置在指定时间直接执行脚本，无需 AI 介入
 */
export interface CronJobConfig {
    /** 任务名称，用于日志 */
    name: string;
    /** cron 表达式，如 "0 8 * * *" 表示每天 8:00 */
    cron: string;
    /** 时区，如 "Asia/Shanghai"，默认 "Asia/Shanghai" */
    timezone?: string;
    /** 脚本路径，相对 process.cwd() 或绝对路径，支持 .mjs/.ts/.mts */
    script: string;
    /** 要推送的群号列表 */
    groupIds: number[];
}
export declare function getCronJobsFromConfig(api: any): CronJobConfig[];
export declare function startScheduler(api: any): void;
export declare function stopScheduler(): void;
