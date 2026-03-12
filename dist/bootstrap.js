import { cancel as clackCancel, confirm as clackConfirm, intro as clackIntro, isCancel, note as clackNote, outro as clackOutro, text as clackText, } from "@clack/prompts";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const OPENCLAW_HOME = join(homedir(), ".openclaw");
const CONFIG_PATH = join(OPENCLAW_HOME, "openclaw.json");
const AGENTS_ROOT = join(OPENCLAW_HOME, "agents");
const BASE_WORKSPACE = join(OPENCLAW_HOME, "workspace-life");
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PERSONAS_DIR = join(PLUGIN_ROOT, "personas");
const CANONICAL_SOUL_DIR = join(BASE_WORKSPACE, "skills", "soul-switch", "assets", "souls");
const PRESET_PERSONAS = ["normal", "gentle", "laoge", "lezige"];
const WORKSPACE_FILES_TO_SEED = [
    "AGENTS.md",
    "TOOLS.md",
    "IDENTITY.md",
    "USER.md",
    "BOOTSTRAP.md",
    "HEARTBEAT.md",
];
const MINIMAL_ONEBOT_TOOLS_ALLOW = [
    "group:fs",
    "group:runtime",
    "session_status",
    "onebot_send_image",
    "onebot_upload_file",
    "onebot_get_group_msg_history",
    "onebot_delete_msg",
    "onebot_send_mface",
];

function guardCancel(v) {
    if (isCancel(v)) {
        clackCancel("已取消。");
        process.exit(0);
    }
    return v;
}

function readJsonFileSafe(path, fallback = {}) {
    if (!existsSync(path)) {
        return fallback;
    }
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return fallback;
    }
}

function writeJsonFile(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureDir(path) {
    mkdirSync(path, { recursive: true });
}

function ensureFile(path, content = "") {
    if (!existsSync(path)) {
        writeFileSync(path, content, "utf8");
    }
}

function normalizePersonaKey(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/^life-/, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function buildPersonaAgentId(personaKey) {
    const key = normalizePersonaKey(personaKey);
    return key ? `life-${key}` : "life-normal";
}

function findPersonaTemplateFile(personaKey) {
    const key = normalizePersonaKey(personaKey);
    if (!key)
        return "";
    const filePath = join(PERSONAS_DIR, `SOUL_${key}.md`);
    return existsSync(filePath) ? filePath : "";
}

function findAgentById(config, agentId) {
    const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
    return agents.find((agent) => String(agent?.id ?? "").trim() === String(agentId ?? "").trim()) ?? null;
}

function findDefaultOneBotBinding(config) {
    const bindings = Array.isArray(config?.bindings) ? config.bindings : [];
    return bindings.find((binding) => String(binding?.match?.channel ?? "").trim() === "onebot"
        && String(binding?.match?.accountId ?? "default").trim() === "default"
        && binding?.match?.peer == null) ?? null;
}

function detectBaseAgent(config) {
    const onebotDefault = findDefaultOneBotBinding(config);
    if (onebotDefault?.agentId) {
        const agent = findAgentById(config, onebotDefault.agentId);
        if (agent)
            return agent;
    }
    const legacy = findAgentById(config, "lifeagent");
    if (legacy)
        return legacy;
    const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
    return agents[0] ?? null;
}

function detectModelCandidate(config) {
    const baseAgent = detectBaseAgent(config);
    const directModel = String(baseAgent?.model ?? "").trim();
    if (directModel)
        return directModel;
    const defaultsPrimary = String(config?.agents?.defaults?.model?.primary ?? "").trim();
    if (defaultsPrimary)
        return defaultsPrimary;
    if (typeof config?.agents?.defaults?.model === "string" && config.agents.defaults.model.trim()) {
        return config.agents.defaults.model.trim();
    }
    return "";
}

function ensureWorkspaceSkeleton(targetWorkspace, sourceWorkspace = "") {
    ensureDir(targetWorkspace);
    for (const filename of WORKSPACE_FILES_TO_SEED) {
        const sourceFile = sourceWorkspace ? join(sourceWorkspace, filename) : "";
        const targetFile = join(targetWorkspace, filename);
        if (sourceFile && existsSync(sourceFile) && !existsSync(targetFile)) {
            copyFileSync(sourceFile, targetFile);
            continue;
        }
        ensureFile(targetFile, "");
    }
    const sourceSkillsDir = sourceWorkspace ? join(sourceWorkspace, "skills") : "";
    const targetSkillsDir = join(targetWorkspace, "skills");
    if (sourceSkillsDir && existsSync(sourceSkillsDir) && !existsSync(targetSkillsDir)) {
        cpSync(sourceSkillsDir, targetSkillsDir, { recursive: true });
    }
}

function seedCanonicalSoulTemplates() {
    ensureDir(CANONICAL_SOUL_DIR);
    for (const key of PRESET_PERSONAS) {
        const sourceFile = findPersonaTemplateFile(key);
        if (!sourceFile)
            continue;
        const targetFile = join(CANONICAL_SOUL_DIR, `SOUL_${key}.md`);
        if (!existsSync(targetFile)) {
            copyFileSync(sourceFile, targetFile);
        }
    }
}

function ensureBaseWorkspace(sourceWorkspace = "") {
    ensureWorkspaceSkeleton(BASE_WORKSPACE, sourceWorkspace);
    seedCanonicalSoulTemplates();
}

function ensurePersonaWorkspace(personaKey, sourceWorkspace = "") {
    const key = normalizePersonaKey(personaKey);
    const targetWorkspace = join(OPENCLAW_HOME, `workspace-life-${key}`);
    ensureWorkspaceSkeleton(targetWorkspace, sourceWorkspace || BASE_WORKSPACE);
    const templateFile = findPersonaTemplateFile(key);
    if (templateFile && !existsSync(join(targetWorkspace, "SOUL.md"))) {
        copyFileSync(templateFile, join(targetWorkspace, "SOUL.md"));
    }
    seedCanonicalSoulTemplates();
    return targetWorkspace;
}

function ensureAgentDir(targetAgentId, sourceAgentDir = "") {
    const targetAgentRoot = join(AGENTS_ROOT, targetAgentId);
    const targetAgentDir = join(targetAgentRoot, "agent");
    ensureDir(targetAgentDir);
    ensureDir(join(targetAgentRoot, "sessions"));
    for (const filename of ["auth-profiles.json", "models.json"]) {
        const sourceFile = sourceAgentDir ? join(sourceAgentDir, filename) : "";
        const targetFile = join(targetAgentDir, filename);
        if (sourceFile && existsSync(sourceFile) && !existsSync(targetFile)) {
            copyFileSync(sourceFile, targetFile);
        }
    }
    return targetAgentDir;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function buildPersonaAgent(config, baseAgent, personaKey, modelText) {
    const key = normalizePersonaKey(personaKey);
    const agentId = buildPersonaAgentId(key);
    const workspace = ensurePersonaWorkspace(key, String(baseAgent?.workspace ?? "").trim());
    const agentDir = ensureAgentDir(agentId, String(baseAgent?.agentDir ?? "").trim());
    const inherited = baseAgent ? cloneJson(baseAgent) : {};
    const nextAgent = {
        ...inherited,
        id: agentId,
        name: agentId,
        workspace,
        agentDir,
    };
    const trimmedModel = String(modelText ?? "").trim();
    if (trimmedModel) {
        nextAgent.model = trimmedModel;
    }
    else if (!baseAgent?.model) {
        delete nextAgent.model;
    }
    if (!Array.isArray(nextAgent?.skills)) {
        delete nextAgent.skills;
    }
    if (!nextAgent?.tools && !baseAgent) {
        nextAgent.tools = { allow: [...MINIMAL_ONEBOT_TOOLS_ALLOW] };
    }
    return nextAgent;
}

function upsertAgent(config, nextAgent) {
    if (!config.agents) {
        config.agents = {};
    }
    if (!Array.isArray(config.agents.list)) {
        config.agents.list = [];
    }
    const list = config.agents.list;
    const index = list.findIndex((agent) => String(agent?.id ?? "").trim() === String(nextAgent?.id ?? "").trim());
    if (index >= 0) {
        list[index] = {
            ...list[index],
            ...nextAgent,
        };
        return "updated";
    }
    list.push(nextAgent);
    return "created";
}

function upsertDefaultOneBotBinding(config, agentId) {
    if (!Array.isArray(config.bindings)) {
        config.bindings = [];
    }
    const bindings = config.bindings;
    const nextBinding = {
        agentId,
        match: {
            channel: "onebot",
            accountId: "default",
        },
    };
    const index = bindings.findIndex((binding) => String(binding?.match?.channel ?? "").trim() === "onebot"
        && String(binding?.match?.accountId ?? "default").trim() === "default"
        && binding?.match?.peer == null);
    if (index >= 0) {
        bindings[index] = nextBinding;
        return "updated";
    }
    bindings.push(nextBinding);
    return "created";
}

export async function runOneBotPersonaBootstrap() {
    clackIntro("OneBot 预设人格初始化");
    const config = readJsonFileSafe(CONFIG_PATH, {});
    const baseAgent = detectBaseAgent(config);
    const defaultModel = detectModelCandidate(config);
    if (!baseAgent) {
        clackNote("未找到可继承的基础 agent。将创建最小化 persona agents。", "提示");
    }
    else {
        clackNote(`将基于现有 agent「${baseAgent.id}」继承 workspace 结构、skills 和 tools。`, "基础 agent");
    }
    const installAll = guardCancel(await clackConfirm({
        message: "安装内置的 4 个预设人格（normal / gentle / laoge / lezige）？",
        initialValue: true,
    }));
    if (!installAll) {
        clackCancel("未安装预设人格。");
        return;
    }
    const modelText = guardCancel(await clackText({
        message: "预设人格使用的模型（留空则尽量继承当前基础 agent / 默认模型）",
        initialValue: defaultModel,
        placeholder: "例如 openai-hk/gemini-3-flash-preview",
    }));
    const existingDefaultBinding = findDefaultOneBotBinding(config);
    const shouldSetDefault = guardCancel(await clackConfirm({
        message: existingDefaultBinding?.agentId && existingDefaultBinding.agentId !== "life-normal"
            ? `当前 onebot 默认绑定是 ${existingDefaultBinding.agentId}，是否改成 life-normal？`
            : "是否将 onebot 默认人格设置为 life-normal？",
        initialValue: true,
    }));
    ensureDir(OPENCLAW_HOME);
    ensureDir(AGENTS_ROOT);
    ensureBaseWorkspace(String(baseAgent?.workspace ?? "").trim());
    const summary = [];
    for (const key of PRESET_PERSONAS) {
        const agent = buildPersonaAgent(config, baseAgent, key, modelText);
        const action = upsertAgent(config, agent);
        summary.push(`${action === "created" ? "创建" : "更新"} ${agent.id}`);
    }
    if (shouldSetDefault) {
        const bindingAction = upsertDefaultOneBotBinding(config, "life-normal");
        summary.push(`${bindingAction === "created" ? "创建" : "更新"} onebot 默认绑定 -> life-normal`);
    }
    writeJsonFile(CONFIG_PATH, config);
    clackNote(summary.join("\n"), "结果");
    clackOutro(`预设人格已写入 ${CONFIG_PATH}\n如果 gateway 正在运行，请执行 openclaw gateway restart`);
}
