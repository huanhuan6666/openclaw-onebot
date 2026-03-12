import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path, { join } from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const _PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));
const VOICE_PROFILES_FILE = join(_PLUGIN_ROOT, "voice-profiles.json");
const VOICE_SECRETS_FILE = join(_PLUGIN_ROOT, "voice-secrets.json");
const VOICE_DEBUG_DIR = join(_PLUGIN_ROOT, "voice-debug");
const VOICE_ANNOTATION_LOG_FILE = join(VOICE_DEBUG_DIR, "annotation.jsonl");
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_TEXT_LENGTH = 1200;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini-tts";
const DEFAULT_OPENAI_VOICE = "alloy";
const DEFAULT_ANNOTATION_PROVIDER = "openai-hk";
const DEFAULT_ANNOTATION_MODEL = "gpt-5-nano";
const DEFAULT_ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_ELEVENLABS_VOICE_ID = "pMsXgVXv3BLzUgSXRplE";
const DEFAULT_FISHAUDIO_BASE_URL = "https://api.fish.audio";
const DEFAULT_FISHAUDIO_MODEL = "s2-pro";
const DEFAULT_EDGE_PROFILE = {
    provider: "edge",
    voice: "zh-CN-XiaoxiaoNeural",
    lang: "zh-CN",
    outputFormat: "audio-24khz-48kbitrate-mono-mp3",
    maxTextLength: DEFAULT_MAX_TEXT_LENGTH,
};
const DEFAULT_VOICE_PROFILES = {
    default: DEFAULT_EDGE_PROFILE,
    agents: {},
};
let edgeTtsClassPromise = null;

function readJsonFile(filePath, fallback) {
    try {
        if (!existsSync(filePath)) {
            return fallback;
        }
        return JSON.parse(readFileSync(filePath, "utf8"));
    }
    catch {
        return fallback;
    }
}

function writeVoiceAnnotationTap(payload) {
    try {
        mkdirSync(VOICE_DEBUG_DIR, { recursive: true });
        appendFileSync(VOICE_ANNOTATION_LOG_FILE, `${JSON.stringify({
            timestamp: new Date().toISOString(),
            ...payload,
        })}\n`, "utf8");
    }
    catch {
    }
}

function resolveOpenClawRequire() {
    const candidates = [
        process.argv?.[1],
        "/home/hzhang/.nvm/versions/node/v22.22.1/lib/node_modules/openclaw/openclaw.mjs",
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            const require = createRequire(candidate);
            require.resolve("node-edge-tts");
            return require;
        }
        catch {
        }
    }
    throw new Error("无法定位 OpenClaw 运行时依赖（node-edge-tts）");
}

async function loadEdgeTtsClass() {
    if (!edgeTtsClassPromise) {
        edgeTtsClassPromise = (async () => {
            const require = resolveOpenClawRequire();
            const resolved = require.resolve("node-edge-tts");
            const mod = await import(pathToFileURL(resolved).href);
            return mod.EdgeTTS ?? mod.default?.EdgeTTS ?? mod.default;
        })();
    }
    return edgeTtsClassPromise;
}

function normalizeVoiceProfiles(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const defaultProfile = {
        ...DEFAULT_EDGE_PROFILE,
        ...(source.default && typeof source.default === "object" ? source.default : {}),
    };
    const agents = {};
    const rawAgents = source.agents && typeof source.agents === "object" ? source.agents : {};
    for (const [agentId, profile] of Object.entries(rawAgents)) {
        if (!profile || typeof profile !== "object") {
            continue;
        }
        agents[String(agentId)] = { ...profile };
    }
    return { default: defaultProfile, agents };
}

export function resolveVoiceProfiles() {
    return normalizeVoiceProfiles(readJsonFile(VOICE_PROFILES_FILE, DEFAULT_VOICE_PROFILES));
}

export function resolveVoiceProfile(agentId) {
    const profiles = resolveVoiceProfiles();
    return {
        ...profiles.default,
        ...(profiles.agents?.[String(agentId ?? "").trim()] ?? {}),
    };
}
function resolveVoiceSecrets() {
    return readJsonFile(VOICE_SECRETS_FILE, {});
}

function cleanupTempDir(tempDir, delayMs = 15 * 60 * 1000) {
    setTimeout(() => {
        try {
            rmSync(tempDir, { recursive: true, force: true });
        }
        catch {
        }
    }, delayMs).unref();
}

function normalizeSpeechText(text, maxTextLength) {
    const normalized = String(text ?? "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/_([^_]+)_/g, "$1")
        .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1")
        .replace(/\[(?:表情|动画表情)(?:[:：][^\]\n]{0,120})?\]/g, " ")
        .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]+/gu, " ")
        .replace(/[#>-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const limit = Number(maxTextLength);
    if (Number.isFinite(limit) && limit > 0 && normalized.length > limit) {
        return `${normalized.slice(0, Math.max(1, limit - 1)).trim()}…`;
    }
    return normalized;
}
function normalizeComparableText(text) {
    return String(text ?? "")
        .replace(/\[[^\]\n]{1,80}\]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function countBracketCues(text) {
    return (String(text ?? "").match(/\[[^\]\n]{1,80}\]/g) ?? []).length;
}
function extractJsonObject(text) {
    const raw = String(text ?? "").trim();
    if (!raw)
        return null;
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        try {
            return JSON.parse(fenced[1]);
        }
        catch {
        }
    }
    try {
        return JSON.parse(raw);
    }
    catch {
    }
    const braceStart = raw.indexOf("{");
    const braceEnd = raw.lastIndexOf("}");
    if (braceStart >= 0 && braceEnd > braceStart) {
        try {
            return JSON.parse(raw.slice(braceStart, braceEnd + 1));
        }
        catch {
        }
    }
    return null;
}
function buildAnnotationContext(context) {
    const parts = [];
    const persona = String(context?.agentId ?? "").trim();
    if (persona) {
        parts.push(`Persona: ${persona}`);
    }
    const triggerKind = String(context?.triggerKind ?? "").trim();
    if (triggerKind) {
        parts.push(`Trigger: ${triggerKind}`);
    }
    const userMessage = String(context?.userMessage ?? "").trim();
    if (userMessage) {
        parts.push(`Latest user message: ${userMessage}`);
    }
    const recentHistory = Array.isArray(context?.recentHistory) ? context.recentHistory : [];
    if (recentHistory.length > 0) {
        parts.push("Recent context:");
        for (const item of recentHistory.slice(-4)) {
            const sender = String(item?.sender ?? "user").trim();
            const body = String(item?.body ?? "").replace(/\s+/g, " ").trim();
            if (!body)
                continue;
            parts.push(`- ${sender}: ${body}`);
        }
    }
    return parts.join("\n").trim();
}
function resolveAnnotationConfig(profile) {
    const raw = profile?.annotation;
    if (raw === false) {
        return { enabled: false };
    }
    const source = raw && typeof raw === "object" ? raw : {};
    return {
        enabled: source.enabled !== false,
        provider: String(source.provider ?? DEFAULT_ANNOTATION_PROVIDER).trim() || DEFAULT_ANNOTATION_PROVIDER,
        model: String(source.model ?? DEFAULT_ANNOTATION_MODEL).trim() || DEFAULT_ANNOTATION_MODEL,
        maxCues: Number.isFinite(Number(source.maxCues)) ? Math.max(0, Math.trunc(Number(source.maxCues))) : 3,
        temperature: Number.isFinite(Number(source.temperature)) ? Number(source.temperature) : 0.2,
    };
}
async function annotateFishS2Text(cfg, profile, text, context) {
    const annotation = resolveAnnotationConfig(profile);
    if (!annotation.enabled) {
        return { text, applied: false, skipped: "annotation disabled" };
    }
    const provider = cfg?.models?.providers?.[annotation.provider];
    const apiKey = String(provider?.apiKey ?? "").trim();
    const baseUrl = String(provider?.baseUrl ?? "").trim().replace(/\/+$/, "");
    if (!apiKey || !baseUrl) {
        return { text, applied: false, skipped: "annotation provider not configured" };
    }
    const startedAt = Date.now();
    try {
        const endpoint = `${baseUrl}/chat/completions`;
        const originalText = String(text ?? "").trim();
        const contextText = buildAnnotationContext(context);
        const promptPayload = {
            reply_text: originalText,
            context: contextText,
            rules: [
                "Only insert short [bracket] cues for Fish Audio S2-Pro natural-language control.",
                "Do not change, add, remove, summarize, censor, or reorder the spoken words.",
                "Return the original reply unchanged if no cue is needed.",
                "Use at most 3 bracket cues total.",
                "Bracket cues must be short, natural stage directions like [softly], [laughing], [mocking lightly].",
            ],
            output_schema: {
                annotated_text: "string",
            },
        };
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: annotation.model,
                temperature: annotation.temperature,
                max_tokens: 400,
                messages: [
                    {
                        role: "system",
                        content: "You are a TTS cue annotator. Your only job is to insert a few short [bracket] delivery cues for Fish Audio S2-Pro. Preserve the original spoken words exactly. Output valid JSON only.",
                    },
                    {
                        role: "user",
                        content: JSON.stringify(promptPayload),
                    },
                ],
            }),
        });
        if (!response.ok) {
            const details = (await response.text().catch(() => "")).trim();
            const result = { text, applied: false, skipped: `annotation api error ${response.status}${details ? `: ${details.slice(0, 120)}` : ""}` };
            writeVoiceAnnotationTap({
                agentId: context?.agentId,
                annotationProvider: annotation.provider,
                annotationModel: annotation.model,
                elapsedMs: Date.now() - startedAt,
                applied: false,
                skipped: result.skipped,
                inputText: originalText,
                outputText: originalText,
                context: contextText,
            });
            return result;
        }
        const data = await response.json();
        const rawContent = String(data?.choices?.[0]?.message?.content ?? "").trim();
        const parsed = extractJsonObject(rawContent);
        const annotatedText = String(parsed?.annotated_text ?? rawContent).trim();
        if (!annotatedText) {
            const result = { text, applied: false, skipped: "empty annotation response" };
            writeVoiceAnnotationTap({
                agentId: context?.agentId,
                annotationProvider: annotation.provider,
                annotationModel: annotation.model,
                elapsedMs: Date.now() - startedAt,
                applied: false,
                skipped: result.skipped,
                inputText: originalText,
                outputText: originalText,
                rawModelOutput: rawContent,
                context: contextText,
            });
            return result;
        }
        if (countBracketCues(annotatedText) > annotation.maxCues) {
            const result = { text, applied: false, skipped: "too many cues" };
            writeVoiceAnnotationTap({
                agentId: context?.agentId,
                annotationProvider: annotation.provider,
                annotationModel: annotation.model,
                elapsedMs: Date.now() - startedAt,
                applied: false,
                skipped: result.skipped,
                inputText: originalText,
                outputText: originalText,
                rawModelOutput: rawContent,
                annotatedText,
                context: contextText,
            });
            return result;
        }
        if (normalizeComparableText(annotatedText) !== normalizeComparableText(originalText)) {
            const result = { text, applied: false, skipped: "annotator changed spoken text" };
            writeVoiceAnnotationTap({
                agentId: context?.agentId,
                annotationProvider: annotation.provider,
                annotationModel: annotation.model,
                elapsedMs: Date.now() - startedAt,
                applied: false,
                skipped: result.skipped,
                inputText: originalText,
                outputText: originalText,
                rawModelOutput: rawContent,
                annotatedText,
                context: contextText,
            });
            return result;
        }
        const result = {
            text: annotatedText,
            applied: annotatedText !== originalText,
        };
        writeVoiceAnnotationTap({
            agentId: context?.agentId,
            annotationProvider: annotation.provider,
            annotationModel: annotation.model,
            elapsedMs: Date.now() - startedAt,
            applied: result.applied,
            inputText: originalText,
            outputText: annotatedText,
            rawModelOutput: rawContent,
            context: contextText,
        });
        return result;
    }
    catch (error) {
        const result = {
            text,
            applied: false,
            skipped: `annotation error: ${error instanceof Error ? error.message : String(error)}`,
        };
        writeVoiceAnnotationTap({
            agentId: context?.agentId,
            annotationProvider: annotation.provider,
            annotationModel: annotation.model,
            elapsedMs: Date.now() - startedAt,
            applied: false,
            skipped: result.skipped,
            inputText: String(text ?? "").trim(),
            outputText: String(text ?? "").trim(),
            context: buildAnnotationContext(context),
        });
        return result;
    }
}

function resolveOutputExtension(format) {
    const normalized = String(format ?? "").toLowerCase();
    if (normalized.includes("wav") || normalized.includes("pcm")) {
        return ".wav";
    }
    if (normalized.includes("opus")) {
        return ".opus";
    }
    if (normalized.includes("ogg")) {
        return ".ogg";
    }
    return ".mp3";
}

async function synthesizeWithEdge(profile, text) {
    const EdgeTTS = await loadEdgeTtsClass();
    const tempDir = mkdtempSync(join(tmpdir(), "openclaw-onebot-tts-"));
    const outputFormat = String(profile.outputFormat ?? DEFAULT_EDGE_PROFILE.outputFormat);
    const outputPath = join(tempDir, `voice-${Date.now()}${resolveOutputExtension(outputFormat)}`);
    await new EdgeTTS({
        voice: profile.voice ?? DEFAULT_EDGE_PROFILE.voice,
        lang: profile.lang ?? DEFAULT_EDGE_PROFILE.lang,
        outputFormat,
        pitch: profile.pitch,
        rate: profile.rate,
        volume: profile.volume,
        timeout: Number(profile.timeoutMs) || DEFAULT_TIMEOUT_MS,
    }).ttsPromise(text, outputPath);
    cleanupTempDir(tempDir);
    return {
        provider: "edge",
        audioPath: outputPath,
        voice: profile.voice ?? DEFAULT_EDGE_PROFILE.voice,
    };
}

async function synthesizeWithOpenAi(cfg, profile, text) {
    const apiKey = cfg?.messages?.tts?.openai?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("OpenAI TTS 未配置 API key");
    }
    const baseUrl = String(cfg?.messages?.tts?.openai?.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
    const model = String(profile.model ?? cfg?.messages?.tts?.openai?.model ?? DEFAULT_OPENAI_MODEL);
    const voice = String(profile.voice ?? cfg?.messages?.tts?.openai?.voice ?? DEFAULT_OPENAI_VOICE);
    const responseFormat = String(profile.responseFormat ?? "mp3");
    const response = await fetch(`${baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            input: text,
            voice,
            response_format: responseFormat,
        }),
    });
    if (!response.ok) {
        throw new Error(`OpenAI TTS API error (${response.status})`);
    }
    const tempDir = mkdtempSync(join(tmpdir(), "openclaw-onebot-tts-"));
    const outputPath = join(tempDir, `voice-${Date.now()}${resolveOutputExtension(responseFormat)}`);
    writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
    cleanupTempDir(tempDir);
    return {
        provider: "openai",
        audioPath: outputPath,
        voice,
        model,
    };
}

async function synthesizeWithElevenLabs(cfg, profile, text) {
    const apiKey = cfg?.messages?.tts?.elevenlabs?.apiKey ?? process.env.ELEVENLABS_API_KEY ?? process.env.XI_API_KEY;
    if (!apiKey) {
        throw new Error("ElevenLabs TTS 未配置 API key");
    }
    const baseUrl = String(cfg?.messages?.tts?.elevenlabs?.baseUrl ?? DEFAULT_ELEVENLABS_BASE_URL).replace(/\/+$/, "");
    const voiceId = String(profile.voiceId ?? cfg?.messages?.tts?.elevenlabs?.voiceId ?? DEFAULT_ELEVENLABS_VOICE_ID);
    const modelId = String(profile.modelId ?? cfg?.messages?.tts?.elevenlabs?.modelId ?? DEFAULT_ELEVENLABS_MODEL_ID);
    const outputFormat = String(profile.outputFormat ?? "mp3_44100_128");
    const response = await fetch(`${baseUrl}/v1/text-to-speech/${voiceId}?output_format=${encodeURIComponent(outputFormat)}`, {
        method: "POST",
        headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
        },
        body: JSON.stringify({
            text,
            model_id: modelId,
        }),
    });
    if (!response.ok) {
        throw new Error(`ElevenLabs API error (${response.status})`);
    }
    const tempDir = mkdtempSync(join(tmpdir(), "openclaw-onebot-tts-"));
    const outputPath = join(tempDir, `voice-${Date.now()}.mp3`);
    writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
    cleanupTempDir(tempDir);
    return {
        provider: "elevenlabs",
        audioPath: outputPath,
        voice: voiceId,
        model: modelId,
    };
}
async function synthesizeWithFishAudio(profile, text) {
    const secrets = resolveVoiceSecrets();
    const apiKey = profile.apiKey
        ?? secrets?.fishaudio?.apiKey
        ?? process.env.FISH_AUDIO_API_KEY
        ?? process.env.FISH_API_KEY;
    if (!apiKey) {
        throw new Error("Fish Audio 未配置 API key");
    }
    const referenceId = String(profile.referenceId ?? profile.voiceId ?? profile.voice ?? "").trim();
    if (!referenceId) {
        throw new Error("Fish Audio 未配置 reference_id");
    }
    const baseUrl = String(profile.baseUrl ?? DEFAULT_FISHAUDIO_BASE_URL).replace(/\/+$/, "");
    const model = String(profile.model ?? DEFAULT_FISHAUDIO_MODEL).trim() || DEFAULT_FISHAUDIO_MODEL;
    const format = String(profile.format ?? profile.responseFormat ?? "mp3").trim() || "mp3";
    const body = {
        text,
        reference_id: referenceId,
        format,
        latency: String(profile.latency ?? "balanced"),
        chunk_length: Number.isFinite(Number(profile.chunkLength)) ? Math.max(50, Math.trunc(Number(profile.chunkLength))) : 200,
        normalize: profile.normalize === undefined ? true : Boolean(profile.normalize),
        prosody: {
            speed: Number.isFinite(Number(profile.speed)) ? Number(profile.speed) : 1,
            volume: Number.isFinite(Number(profile.volumeDb)) ? Number(profile.volumeDb) : 0,
        },
    };
    if (!Number.isFinite(body.prosody.speed) || body.prosody.speed <= 0) {
        delete body.prosody.speed;
    }
    if (!Number.isFinite(body.prosody.volume)) {
        delete body.prosody.volume;
    }
    if (Object.keys(body.prosody).length === 0) {
        delete body.prosody;
    }
    const response = await fetch(`${baseUrl}/v1/tts`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            model,
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const details = (await response.text().catch(() => "")).trim();
        throw new Error(`Fish Audio API error (${response.status})${details ? `: ${details.slice(0, 200)}` : ""}`);
    }
    const tempDir = mkdtempSync(join(tmpdir(), "openclaw-onebot-tts-"));
    const outputPath = join(tempDir, `voice-${Date.now()}${resolveOutputExtension(format)}`);
    writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
    cleanupTempDir(tempDir);
    return {
        provider: "fishaudio",
        audioPath: outputPath,
        voice: referenceId,
        model,
    };
}

function resolveProviderOrder(profile) {
    const primary = String(profile.provider ?? "edge").trim().toLowerCase();
    return [...new Set([primary, "edge"])];
}

export async function synthesizeVoiceReply(params) {
    const profile = resolveVoiceProfile(params.agentId);
    const maxTextLength = Number(profile.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH);
    const normalizedMaxTextLength = Number.isFinite(maxTextLength) && maxTextLength > 0 ? maxTextLength : DEFAULT_MAX_TEXT_LENGTH;
    const text = normalizeSpeechText(params.text, normalizedMaxTextLength);
    if (!text) {
        return { success: false, error: "没有可用于语音合成的文本" };
    }
    const errors = [];
    for (const provider of resolveProviderOrder(profile)) {
        try {
            if (provider === "openai") {
                return {
                    success: true,
                    profile,
                    ...(await synthesizeWithOpenAi(params.cfg, profile, text)),
                };
            }
            if (provider === "elevenlabs") {
                return {
                    success: true,
                    profile,
                    ...(await synthesizeWithElevenLabs(params.cfg, profile, text)),
                };
            }
            if (provider === "fishaudio" || provider === "fish-audio") {
                const fishText = String(profile?.model ?? "").trim().toLowerCase() === "s2-pro"
                    ? (await annotateFishS2Text(params.cfg, profile, text, {
                        ...(params.context && typeof params.context === "object" ? params.context : {}),
                        agentId: params.agentId,
                    })).text
                    : text;
                return {
                    success: true,
                    profile,
                    ...(await synthesizeWithFishAudio(profile, fishText)),
                };
            }
            return {
                success: true,
                profile,
                ...(await synthesizeWithEdge(profile, text)),
            };
        }
        catch (error) {
            errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return {
        success: false,
        error: `TTS 失败：${errors.join("; ") || "无可用 provider"}`,
    };
}
