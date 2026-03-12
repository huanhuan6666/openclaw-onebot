/**
 * OpenClaw / ClawdBot Plugin SDK 懒加载
 */
export declare function loadPluginSdk(): Promise<void>;
export declare function getSdk(): {
    buildPendingHistoryContextFromMap: any;
    recordPendingHistoryEntry: any;
    clearHistoryEntriesIfEnabled: any;
};
