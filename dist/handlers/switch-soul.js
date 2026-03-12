/**
 * /switch <persona> [继续内容]
 * 将当前群/私聊绑定到固定人格 agent，而不是覆盖共享 SOUL.md。
 *
 * 用法：
 *   @机器人 /switch laoge
 *   @机器人 /switch cute 刚才那个话题继续
 *   @机器人 /switch default
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getOneBotConfig } from "../config.js";
import { sendGroupMsg, sendPrivateMsg } from "../connection.js";

const HOME_DIR = process.env.HOME ?? "/home/hzhang";
const OPENCLAW_ROOT = join(HOME_DIR, ".openclaw");
const WORKSPACE_LIFE = join(OPENCLAW_ROOT, "workspace-life");
const SOUL_SKILL_ASSETS_DIR = join(WORKSPACE_LIFE, "skills", "soul-switch", "assets", "souls");
const CONFIG_FILE = join(OPENCLAW_ROOT, "openclaw.json");
const AGENTS_ROOT = join(OPENCLAW_ROOT, "agents");
const WORKSPACE_FILES_TO_SEED = [
    "AGENTS.md",
    "TOOLS.md",
    "IDENTITY.md",
    "USER.md",
    "BOOTSTRAP.md",
    "HEARTBEAT.md",
];
const RESET_ALIASES = new Set(["default", "reset", "base", "lifeagent"]);
const LIST_ALIASES = new Set(["list", "ls", "show", "help", "all"]);

function isPersonaAgentId(agentId) {
    return /^life-[a-z0-9-]+$/i.test(String(agentId ?? "").trim());
}

function normalizePersonaKey(value) {
    let normalized = String(value ?? "").trim().toLowerCase();
    if (normalized.startsWith("life-"))
        normalized = normalized.slice(5);
    return normalized;
}

function buildPersonaAgentId(personaKey) {
    const slug = normalizePersonaKey(personaKey).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug ? `life-${slug}` : "lifeagent";
}

function readSoulProfileTitleFromText(content, fallback = "") {
    const text = String(content ?? "");
    const profileMatch = text.match(/^#\s*SOULS?\s*Profile:\s*(.+)$/im);
    if (profileMatch?.[1]?.trim()) {
        return profileMatch[1].trim();
    }
    const firstHeading = text.match(/^#\s+(.+)$/m);
    if (firstHeading?.[1]?.trim()) {
        return firstHeading[1].trim();
    }
    return fallback;
}

function readSoulProfileTitle(filePath, fallback = "") {
    try {
        return readSoulProfileTitleFromText(readFileSync(filePath, "utf8"), fallback);
    }
    catch {
        return fallback;
    }
}

function findPersonaAssetTemplateFile(personaKey) {
    const normalized = normalizePersonaKey(personaKey);
    if (!normalized)
        return null;
    const filePath = join(SOUL_SKILL_ASSETS_DIR, `SOUL_${normalized}.md`);
    return existsSync(filePath) ? filePath : null;
}

function compactSwitchText(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/^@\S+\s*/g, "")
        .replace(/[`"'“”‘’（）()【】\[\]{}<>《》、，,。.!！?？:：;；/\\\-_]+/g, "")
        .replace(/\s+/g, "");
}

function collectPersonaAliases(personaKey, title = "") {
    const aliases = new Set();
    const normalizedKey = normalizePersonaKey(personaKey);
    if (normalizedKey) {
        aliases.add(normalizedKey);
        aliases.add(buildPersonaAgentId(normalizedKey));
    }
    const normalizedTitle = String(title ?? "").trim();
    if (normalizedTitle) {
        aliases.add(normalizedTitle);
        const head = normalizedTitle.split(/\s*\(/, 1)[0]?.trim();
        if (head) {
            aliases.add(head);
        }
        const parenMatches = normalizedTitle.match(/\(([^)]+)\)/g) ?? [];
        for (const item of parenMatches) {
            const inner = item.replace(/[()]/g, "").trim();
            if (inner) {
                aliases.add(inner);
            }
        }
    }
    return [...aliases].map((item) => String(item).trim()).filter(Boolean);
}

function findAgentById(config, agentId) {
    const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
    return agents.find((agent) => String(agent?.id ?? "").trim() === String(agentId ?? "").trim()) ?? null;
}

function listPersonaDescriptors(config = null) {
    const descriptors = [];
    try {
        const effectiveConfig = config ?? readGatewayConfigFile();
        const agents = Array.isArray(effectiveConfig?.agents?.list) ? effectiveConfig.agents.list : [];
        for (const agent of agents) {
            const agentId = String(agent?.id ?? "").trim();
            if (!isPersonaAgentId(agentId))
                continue;
            const key = normalizePersonaKey(agentId);
            const workspaceDir = String(agent?.workspace ?? "").trim();
            const workspaceSoulFile = workspaceDir ? join(workspaceDir, "SOUL.md") : "";
            const assetTemplateFile = findPersonaAssetTemplateFile(key);
            const title = readSoulProfileTitle(workspaceSoulFile, readSoulProfileTitle(assetTemplateFile, key));
            descriptors.push({
                key,
                agentId,
                title,
                workspaceDir,
                workspaceSoulFile,
                templateFile: existsSync(workspaceSoulFile) ? workspaceSoulFile : assetTemplateFile,
                aliases: collectPersonaAliases(key, title),
            });
        }
    }
    catch {
    }
    descriptors.sort((a, b) => a.key.localeCompare(b.key, "zh-Hans-CN"));
    return descriptors;
}

function listPersonas(config = null) {
    return listPersonaDescriptors(config).map((item) => item.key);
}

function resolvePersonaTemplateFile(personaKey, config = null) {
    const normalized = normalizePersonaKey(personaKey);
    for (const descriptor of listPersonaDescriptors(config)) {
        if (descriptor.key !== normalized)
            continue;
        if (descriptor.templateFile && existsSync(descriptor.templateFile)) {
            return descriptor.templateFile;
        }
    }
    return findPersonaAssetTemplateFile(normalized);
}

function resolvePersonaDescriptorFromText(input, config = null) {
    const compactInput = compactSwitchText(input);
    if (!compactInput)
        return null;
    const descriptors = listPersonaDescriptors(config).sort((a, b) => {
        const aLen = Math.max(...a.aliases.map((item) => compactSwitchText(item).length), 0);
        const bLen = Math.max(...b.aliases.map((item) => compactSwitchText(item).length), 0);
        return bLen - aLen;
    });
    for (const descriptor of descriptors) {
        for (const alias of descriptor.aliases) {
            const compactAlias = compactSwitchText(alias);
            if (!compactAlias || compactAlias.length < 1)
                continue;
            if (compactInput.includes(compactAlias)) {
                return descriptor;
            }
        }
    }
    return null;
}

function looksLikePersonaListIntent(input) {
    const compactInput = compactSwitchText(input);
    if (!compactInput)
        return false;
    const normalized = compactInput
        .replace(/你|请|帮我|帮忙|给我|让我|一下|下|吧|吗|呢|呀|啊|哦|看看|看下|显示|查看/g, "")
        .replace(/都|现有|现存|当前|现在|可用|所有|全部|还有哪些|有哪些|有什么|列出|列一下/g, "")
        .replace(/人格列表|角色列表|persona列表|人格清单|角色清单|persona清单/g, "")
        .replace(/人格|角色|persona/g, "");
    return normalized.length === 0;
}

function looksLikeDefaultSwitchIntent(input) {
    const compactInput = compactSwitchText(input);
    if (!compactInput)
        return false;
    if (!(compactInput.includes("默认") || compactInput.includes("base") || compactInput.includes("lifeagent"))) {
        return false;
    }
    const residue = compactInput
        .replace(/默认人格|默认|初始人格|原来的人格|原人格|lifeagent|base/g, "")
        .replace(/请|帮我|帮忙|给我|让我|一下|下|吧|吗|呢|呀|啊|哦/g, "")
        .replace(/切换回|切回|换回|恢复到|恢复成|恢复|切换成|切换到|切换|换成|换到|换|改成|改到|改|变成|变到|变/g, "")
        .replace(/人格|角色|persona|模式|风格/g, "");
    return residue.length === 0;
}

export function resolveNaturalSwitchCommandText(input) {
    const text = String(input ?? "").trim();
    if (!text || /^\//.test(text)) {
        return null;
    }
    if (looksLikePersonaListIntent(text)) {
        return "/switch";
    }
    if (looksLikeDefaultSwitchIntent(text)) {
        return "/switch default";
    }
    const descriptor = resolvePersonaDescriptorFromText(text);
    if (!descriptor) {
        return null;
    }
    const compactInput = compactSwitchText(text);
    const compactAlias = descriptor.aliases
        .map((item) => compactSwitchText(item))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .find((alias) => compactInput.includes(alias));
    if (!compactAlias) {
        return null;
    }
    if (!/(切换|切回|切成|切到|切为|换成|换到|换回|换|改成|改到|改|变成|变到|变|调成|调到|用|恢复)/.test(text)) {
        return null;
    }
    const residue = compactInput
        .replace(compactAlias, "")
        .replace(/请|帮我|帮忙|给我|让我|一下|下|吧|吗|呢|呀|啊|哦/g, "")
        .replace(/切换回|切回|切换成|切换到|切换为|切换|切成|切到|切为|切|换成|换到|换回|换|改成|改到|改|变成|变到|变|调成|调到|调|用|恢复到|恢复成|恢复/g, "")
        .replace(/人格|角色|persona|模式|风格/g, "");
    if (residue.length > 0) {
        return null;
    }
    return `/switch ${descriptor.key}`;
}

function readGatewayConfigFile() {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

function writeGatewayConfigFile(config) {
    const tmpPath = `${CONFIG_FILE}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    renameSync(tmpPath, CONFIG_FILE);
    globalThis.__onebotGatewayConfig = config;
}

function ensureDir(dirPath) {
    mkdirSync(dirPath, { recursive: true });
}

function ensureWorkspaceForPersona(baseWorkspace, targetWorkspace, templateFile) {
    ensureDir(targetWorkspace);
    for (const filename of WORKSPACE_FILES_TO_SEED) {
        const sourcePath = join(baseWorkspace, filename);
        const targetPath = join(targetWorkspace, filename);
        if (existsSync(sourcePath) && !existsSync(targetPath)) {
            copyFileSync(sourcePath, targetPath);
        }
    }
    const sourceSkillsDir = join(baseWorkspace, "skills");
    const targetSkillsDir = join(targetWorkspace, "skills");
    if (existsSync(sourceSkillsDir) && !existsSync(targetSkillsDir)) {
        cpSync(sourceSkillsDir, targetSkillsDir, { recursive: true });
    }
    copyFileSync(templateFile, join(targetWorkspace, "SOUL.md"));
}

function ensureAgentDirectoryForPersona(baseAgentDir, targetAgentDir) {
    ensureDir(targetAgentDir);
    for (const filename of ["auth-profiles.json", "models.json"]) {
        const sourcePath = join(baseAgentDir, filename);
        const targetPath = join(targetAgentDir, filename);
        if (existsSync(sourcePath)) {
            copyFileSync(sourcePath, targetPath);
        }
    }
    ensureDir(join(dirname(targetAgentDir), "sessions"));
}

function matchesPeerBinding(binding, accountId, peerKind, peerId) {
    const match = binding?.match;
    return String(match?.channel ?? "").trim().toLowerCase() === "onebot"
        && String(match?.accountId ?? "default").trim() === String(accountId ?? "default").trim()
        && String(match?.peer?.kind ?? "").trim().toLowerCase() === String(peerKind ?? "").trim().toLowerCase()
        && String(match?.peer?.id ?? "").trim() === String(peerId ?? "").trim();
}

function findCurrentPeerBinding(config, accountId, peerKind, peerId) {
    const bindings = Array.isArray(config?.bindings) ? config.bindings : [];
    return bindings.find((binding) => matchesPeerBinding(binding, accountId, peerKind, peerId)) ?? null;
}

function findOneBotDefaultBinding(config, accountId) {
    const bindings = Array.isArray(config?.bindings) ? config.bindings : [];
    return bindings.find((binding) => String(binding?.match?.channel ?? "").trim().toLowerCase() === "onebot"
        && String(binding?.match?.accountId ?? "default").trim() === String(accountId ?? "default").trim()
        && binding?.match?.peer == null) ?? null;
}

function resolveBasePersonaAgent(config, accountId, targetAgentId = "") {
    const defaultBinding = findOneBotDefaultBinding(config, accountId);
    const defaultAgent = defaultBinding?.agentId ? findAgentById(config, defaultBinding.agentId) : null;
    if (defaultAgent && String(defaultAgent?.id ?? "").trim() !== String(targetAgentId ?? "").trim()) {
        return defaultAgent;
    }
    const legacyAgent = findAgentById(config, "lifeagent");
    if (legacyAgent && String(legacyAgent?.id ?? "").trim() !== String(targetAgentId ?? "").trim()) {
        return legacyAgent;
    }
    const personaAgents = listPersonaDescriptors(config);
    const fallbackDescriptor = personaAgents.find((item) => item.agentId !== String(targetAgentId ?? "").trim());
    if (fallbackDescriptor?.agentId) {
        return findAgentById(config, fallbackDescriptor.agentId);
    }
    return Array.isArray(config?.agents?.list) ? config.agents.list[0] ?? null : null;
}

function upsertPeerBinding(config, accountId, peerKind, peerId, agentId) {
    const bindings = Array.isArray(config?.bindings) ? config.bindings.slice() : [];
    const keptBindings = bindings.filter((binding) => !matchesPeerBinding(binding, accountId, peerKind, peerId));
    if (!agentId) {
        config.bindings = keptBindings;
        return;
    }
    keptBindings.unshift({
        agentId,
        match: {
            channel: "onebot",
            accountId,
            peer: {
                kind: peerKind,
                id: String(peerId),
            },
        },
    });
    config.bindings = keptBindings;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function ensurePersonaAgent(config, personaKey, accountId = "default") {
    const targetAgentId = buildPersonaAgentId(personaKey);
    const existingAgent = findAgentById(config, targetAgentId);
    if (existingAgent) {
        return existingAgent;
    }
    const baseAgent = resolveBasePersonaAgent(config, accountId, targetAgentId);
    if (!baseAgent) {
        throw new Error("openclaw.json 里找不到可用基础 agent，无法创建人格 agent");
    }
    const templateFile = resolvePersonaTemplateFile(personaKey, config);
    if (!templateFile) {
        throw new Error(`找不到人格模板 SOUL_${personaKey}.md`);
    }
    const targetWorkspace = join(dirname(baseAgent.workspace ?? WORKSPACE_LIFE), `workspace-${targetAgentId}`);
    const targetAgentRoot = join(AGENTS_ROOT, targetAgentId);
    const targetAgentDir = join(targetAgentRoot, "agent");
    ensureWorkspaceForPersona(baseAgent.workspace ?? WORKSPACE_LIFE, targetWorkspace, templateFile);
    ensureAgentDirectoryForPersona(baseAgent.agentDir ?? join(AGENTS_ROOT, "lifeagent", "agent"), targetAgentDir);
    if (!config.agents)
        config.agents = {};
    if (!Array.isArray(config.agents.list))
        config.agents.list = [];
    const nextAgent = {
        ...cloneJson(baseAgent),
        id: targetAgentId,
        name: targetAgentId,
        workspace: targetWorkspace,
        agentDir: targetAgentDir,
    };
    const existingIndex = config.agents.list.findIndex((agent) => String(agent?.id ?? "").trim() === targetAgentId);
    if (existingIndex >= 0)
        config.agents.list[existingIndex] = nextAgent;
    else
        config.agents.list.push(nextAgent);
    return nextAgent;
}

function getPeerContext(msg) {
    const isGroup = msg.message_type === "group";
    return isGroup
        ? { isGroup: true, peerKind: "group", peerId: String(msg.group_id ?? ""), replyId: msg.group_id, userId: msg.user_id }
        : { isGroup: false, peerKind: "direct", peerId: String(msg.user_id ?? ""), replyId: msg.user_id, userId: msg.user_id };
}

function parseSwitchCommand(cmdText) {
    const match = String(cmdText ?? "").trim().match(/^\/(?:switch|persona|personas)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/i);
    if (!match)
        return null;
    return {
        persona: match[1]?.trim() ?? "",
        continueText: match[2]?.trim() ?? "",
    };
}

function describeCurrentRoute(config, accountId, peerKind, peerId) {
    const peerBinding = findCurrentPeerBinding(config, accountId, peerKind, peerId);
    if (peerBinding?.agentId) {
        return `${peerBinding.agentId}（当前会话独立绑定）`;
    }
    const fallback = findOneBotDefaultBinding(config, accountId);
    if (fallback?.agentId) {
        return `${fallback.agentId}（默认 onebot 绑定）`;
    }
    return "未找到 onebot 绑定";
}

async function replyToMessage(msg, text, api) {
    const isGroup = msg.message_type === "group";
    const groupId = msg.group_id;
    const userId = msg.user_id;
    const getConfig = () => getOneBotConfig(api);
    if (isGroup && groupId)
        await sendGroupMsg(groupId, text, getConfig);
    else if (userId)
        await sendPrivateMsg(userId, text, getConfig);
}

export function resolveSwitchScopedSessionId(baseSessionId) {
    return String(baseSessionId ?? "").toLowerCase();
}

export async function handleSwitchSoul(api, msg, cmdText) {
    const parsed = parseSwitchCommand(cmdText);
    if (!parsed)
        return false;
    const { persona, continueText } = parsed;
    const { peerKind, peerId } = getPeerContext(msg);
    const accountId = getOneBotConfig(api)?.accountId ?? "default";
    let config;
    try {
        config = readGatewayConfigFile();
    }
    catch (error) {
        await replyToMessage(msg, `读取 openclaw.json 失败：${error?.message ?? error}`, api);
        return { handled: true };
    }

    if (!persona) {
        const personas = listPersonaDescriptors(config);
        const current = describeCurrentRoute(config, accountId, peerKind, peerId);
        const lines = [
            `当前会话：${current}`,
            "",
            personas.length > 0
                ? `可用人格：\n${personas
                    .map((item) => `  • ${item.key} -> ${item.agentId}${item.title && item.title !== item.key ? ` | ${item.title}` : ""}`)
                    .join("\n")}`
                : "暂无可切换的人格模板。",
            "",
            "用法：@我 /switch <名称>",
            "列出人格：@我 /switch 或 @我 /personas",
            "继续接话：@我 /switch <名称> 刚才那个话题继续",
            "恢复默认：@我 /switch default",
        ];
        await replyToMessage(msg, lines.join("\n"), api);
        return { handled: true };
    }

    const personaKey = normalizePersonaKey(persona);
    if (LIST_ALIASES.has(personaKey)) {
        return handleSwitchSoul(api, msg, "/switch");
    }
    const currentPeerBinding = findCurrentPeerBinding(config, accountId, peerKind, peerId);
    const currentAgentId = currentPeerBinding?.agentId ?? findOneBotDefaultBinding(config, accountId)?.agentId ?? "lifeagent";

    if (RESET_ALIASES.has(personaKey)) {
        upsertPeerBinding(config, accountId, peerKind, peerId, null);
        try {
            writeGatewayConfigFile(config);
        }
        catch (error) {
            api.logger?.error?.(`[onebot] switch-soul reset failed: ${error?.message ?? error}`);
            await replyToMessage(msg, `恢复默认失败：${error?.message ?? error}`, api);
            return { handled: true };
        }
        if (!continueText) {
            await replyToMessage(msg, "已恢复到默认 onebot 绑定。下一条开始按默认 agent 处理。", api);
            return { handled: true, nextCfg: config };
        }
        return { handled: true, nextCfg: config, continueWithText: continueText };
    }

    const templateFile = resolvePersonaTemplateFile(personaKey);
    if (!templateFile) {
        const personas = listPersonas(config);
        await replyToMessage(msg, `找不到人格「${personaKey}」。${personas.length > 0 ? `\n可用人格：${personas.join("、")}` : ""}`, api);
        return { handled: true };
    }

    let targetAgent;
    try {
        targetAgent = ensurePersonaAgent(config, personaKey, accountId);
        upsertPeerBinding(config, accountId, peerKind, peerId, targetAgent.id);
        writeGatewayConfigFile(config);
    }
    catch (error) {
        api.logger?.error?.(`[onebot] switch-soul failed: ${error?.message ?? error}`);
        await replyToMessage(msg, `切换失败：${error?.message ?? error}`, api);
        return { handled: true };
    }

    api.logger?.info?.(`[onebot] switch-soul: ${peerKind}:${peerId} ${currentAgentId} -> ${targetAgent.id}`);
    if (!continueText) {
        await replyToMessage(msg, `已切到 ${targetAgent.id}。\n当前会话后续消息会按人格「${personaKey}」处理。`, api);
        return { handled: true, nextCfg: config };
    }
    return {
        handled: true,
        nextCfg: config,
        continueWithText: continueText,
    };
}
