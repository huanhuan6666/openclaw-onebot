/**
 * Agent 工具注册
 * 供 OpenClaw cron 等场景下，AI 调用 OneBot 能力
 */
import { sendPrivateMsg, sendGroupMsg, sendGroupFace, sendGroupMface, sendGroupImage, sendPrivateFace, sendPrivateMface, sendPrivateImage, deleteMsg, setMsgEmojiLike, getGroupMsgHistory, getGroupInfo, getStrangerInfo, getGroupMemberInfo, getAvatarUrl } from "./connection.js";
export interface OneBotClient {
    sendGroupMsg: typeof sendGroupMsg;
    sendGroupFace: typeof sendGroupFace;
    sendGroupMface: typeof sendGroupMface;
    sendGroupImage: typeof sendGroupImage;
    sendPrivateMsg: typeof sendPrivateMsg;
    sendPrivateFace: typeof sendPrivateFace;
    sendPrivateMface: typeof sendPrivateMface;
    sendPrivateImage: typeof sendPrivateImage;
    deleteMsg: typeof deleteMsg;
    setMsgEmojiLike: typeof setMsgEmojiLike;
    getGroupMsgHistory: typeof getGroupMsgHistory;
    getGroupInfo: typeof getGroupInfo;
    getStrangerInfo: typeof getStrangerInfo;
    getGroupMemberInfo: typeof getGroupMemberInfo;
    getAvatarUrl: typeof getAvatarUrl;
}
export declare const onebotClient: OneBotClient;
export declare function registerTools(api: any): void;
