/**
 * 内置定时任务调度器
 * 根据配置在指定时间直接执行脚本，无需 AI 介入
 */
import { CronJob } from "cron";
import { loadScript } from "./load-script.js";
import { onebotClient } from "./tools.js";
import { getWs } from "./connection.js";
import WebSocket from "ws";
let scheduledJobs = [];
export function getCronJobsFromConfig(api) {
    const cfg = api?.config ?? globalThis.__onebotGatewayConfig;
    const jobs = cfg?.channels?.onebot?.cronJobs;
    if (!Array.isArray(jobs) || jobs.length === 0)
        return [];
    return jobs.filter((j) => j &&
        typeof j.name === "string" &&
        typeof j.cron === "string" &&
        typeof j.script === "string" &&
        Array.isArray(j.groupIds));
}
async function runJob(api, job) {
    const logger = api?.logger;
    const w = getWs();
    if (!w || w.readyState !== WebSocket.OPEN) {
        logger?.warn?.(`[onebot] cron "${job.name}" 跳过：OneBot 未连接`);
        return;
    }
    logger?.info?.(`[onebot] cron 执行: ${job.name}`);
    try {
        const mod = await loadScript(job.script);
        const fn = mod?.default ?? mod?.run ?? mod?.execute;
        if (typeof fn !== "function") {
            logger?.error?.(`[onebot] cron "${job.name}": 脚本未导出 default/run/execute 函数`);
            return;
        }
        const ctx = {
            onebot: onebotClient,
            groupIds: job.groupIds,
        };
        const result = await fn(ctx);
        logger?.info?.(`[onebot] cron "${job.name}" 完成: ${result != null ? String(result) : "ok"}`);
    }
    catch (e) {
        logger?.error?.(`[onebot] cron "${job.name}" 失败: ${e?.message}`);
    }
}
export function startScheduler(api) {
    stopScheduler();
    const jobs = getCronJobsFromConfig(api);
    if (jobs.length === 0)
        return;
    const logger = api?.logger;
    logger?.info?.(`[onebot] 启动 ${jobs.length} 个定时任务（无 AI 介入）`);
    for (const job of jobs) {
        try {
            const cronJob = new CronJob(job.cron, () => runJob(api, job), null, true, job.timezone ?? "Asia/Shanghai");
            scheduledJobs.push(cronJob);
        }
        catch (e) {
            logger?.warn?.(`[onebot] cron "${job.name}" 注册失败: ${e?.message}`);
        }
    }
}
export function stopScheduler() {
    for (const j of scheduledJobs) {
        j.stop();
    }
    scheduledJobs = [];
}
