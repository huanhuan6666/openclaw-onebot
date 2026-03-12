import { pathToFileURL } from "node:url";

const DEFAULT_IMAGE_DESCRIPTION_MAX_CHARS = 240;
const DEFAULT_MAX_PENDING_IMAGE_ENTRIES = 3;
const DEFAULT_MAX_IMAGES_PER_ENTRY = 2;
const OPENCLAW_MEDIA_UNDERSTANDING_MODULE = "/home/hzhang/.nvm/versions/node/v22.22.1/lib/node_modules/openclaw/dist/audio-transcription-runner-DjUHzw0r.js";
let mediaUnderstandingModulePromise = null;

function truncateAtSentenceBoundary(text, maxChars) {
    const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!normalized)
        return "";
    if (!Number.isFinite(Number(maxChars)) || normalized.length <= maxChars)
        return normalized;
    const hardLimit = Math.max(1, Math.trunc(Number(maxChars)));
    const beforeLimit = normalized.slice(0, hardLimit);
    const boundaryMatches = Array.from(beforeLimit.matchAll(/[。！？!?；;.!]\s*|\n+/g));
    const lastBoundary = boundaryMatches.at(-1);
    if (lastBoundary && typeof lastBoundary.index === "number") {
        const boundaryEnd = lastBoundary.index + lastBoundary[0].length;
        if (boundaryEnd >= Math.floor(hardLimit * 0.6)) {
            return beforeLimit.slice(0, boundaryEnd).trim();
        }
    }
    const newlineIndex = beforeLimit.lastIndexOf("\n");
    if (newlineIndex >= Math.floor(hardLimit * 0.6)) {
        return beforeLimit.slice(0, newlineIndex).trim();
    }
    return `${beforeLimit.trimEnd()}...`;
}

function buildDescribedBody(entry, descriptions) {
    const base = String(entry?.rawBody ?? entry?.body ?? "").trim();
    if (!base)
        return descriptions.length === 1 ? `[图片描述] ${descriptions[0]}` : descriptions.map((text, index) => `[图片描述 ${index + 1}] ${text}`).join("\n");
    if (descriptions.length === 1) {
        return `${base}\n[图片描述] ${descriptions[0]}`;
    }
    return `${base}\n${descriptions.map((text, index) => `[图片描述 ${index + 1}] ${text}`).join("\n")}`;
}

function shouldRetryImageDescription(entry) {
    if (!Array.isArray(entry?.media?.images) || entry.media.images.length === 0)
        return false;
    if (!entry.mediaDescriptionsResolved)
        return true;
    if (Array.isArray(entry.mediaDescriptions) && entry.mediaDescriptions.length > 0)
        return false;
    const body = String(entry?.body ?? entry?.rawBody ?? "").trim();
    return /<media:image>/i.test(body);
}

function resolveAgentDir(cfg, agentId) {
    const normalized = String(agentId ?? "").trim();
    const agents = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : [];
    if (normalized) {
        const matched = agents.find((entry) => String(entry?.id ?? "").trim() === normalized);
        if (typeof matched?.agentDir === "string" && matched.agentDir.trim()) {
            return matched.agentDir.trim();
        }
    }
    const fallback = agents.find((entry) => typeof entry?.agentDir === "string" && entry.agentDir.trim());
    return typeof fallback?.agentDir === "string" ? fallback.agentDir.trim() : "";
}

async function loadMediaUnderstandingModule() {
    if (!mediaUnderstandingModulePromise) {
        mediaUnderstandingModulePromise = import(pathToFileURL(OPENCLAW_MEDIA_UNDERSTANDING_MODULE).href);
    }
    return mediaUnderstandingModulePromise;
}

async function describeImageWithOpenClaw(image, runtimeContext) {
    const { i: normalizeMediaAttachments, n: buildProviderRegistry, o: resolveMediaAttachmentLocalRoots, r: createMediaAttachmentCache, s: runCapability } = await loadMediaUnderstandingModule();
    const ctx = {
        AccountId: runtimeContext.accountId,
        Provider: runtimeContext.channel,
        Surface: runtimeContext.channel,
        ChatType: runtimeContext.chatType,
        SessionKey: runtimeContext.sessionKey,
        DeliveryContext: {
            channel: runtimeContext.channel,
            accountId: runtimeContext.accountId,
        },
        MediaType: image?.mime,
    };
    if (image?.source === "path") {
        ctx.MediaPath = image.value;
        ctx.MediaPaths = [image.value];
    }
    else {
        ctx.MediaUrl = image?.value;
        ctx.MediaUrls = [image?.value];
    }
    ctx.MediaTypes = [image?.mime];
    const attachments = normalizeMediaAttachments(ctx);
    if (!attachments.length) {
        throw new Error("image attachment unavailable");
    }
    const providerRegistry = buildProviderRegistry();
    const localPathRoots = resolveMediaAttachmentLocalRoots({
        cfg: runtimeContext.cfg,
        ctx,
    });
    const cache = createMediaAttachmentCache(attachments, Array.isArray(localPathRoots) && localPathRoots.length > 0 ? { localPathRoots } : undefined);
    try {
        const result = await runCapability({
            capability: "image",
            cfg: runtimeContext.cfg,
            ctx,
            attachments: cache,
            media: attachments,
            agentDir: runtimeContext.agentDir,
            providerRegistry,
            config: runtimeContext.cfg?.tools?.media?.image,
        });
        const description = result?.outputs?.find((entry) => entry?.kind === "image.description")?.text?.trim();
        if (!description) {
            const decisionReason = String(result?.decision?.outcome ?? "").trim();
            throw new Error(decisionReason ? `image description unavailable: ${decisionReason}` : "image description unavailable");
        }
        return description.replace(/\s+/g, " ").trim();
    }
    finally {
        try {
            await cache.cleanup();
        }
        catch {
        }
    }
}

export async function enrichPendingHistoryImageEntries(entries, logger, options = {}) {
    if (!Array.isArray(entries) || entries.length === 0)
        return;
    const maxEntries = Number.isFinite(Number(options.maxEntries)) ? Math.max(1, Math.trunc(Number(options.maxEntries))) : DEFAULT_MAX_PENDING_IMAGE_ENTRIES;
    const maxImagesPerEntry = Number.isFinite(Number(options.maxImagesPerEntry)) ? Math.max(1, Math.trunc(Number(options.maxImagesPerEntry))) : DEFAULT_MAX_IMAGES_PER_ENTRY;
    const maxChars = Number.isFinite(Number(options.maxChars)) ? Math.max(80, Math.trunc(Number(options.maxChars))) : DEFAULT_IMAGE_DESCRIPTION_MAX_CHARS;
    const runtimeContext = {
        cfg: options.cfg ?? {},
        accountId: String(options.accountId ?? "default").trim() || "default",
        channel: String(options.channel ?? "onebot").trim() || "onebot",
        chatType: String(options.chatType ?? "group").trim() || "group",
        sessionKey: String(options.sessionKey ?? "").trim(),
        agentDir: resolveAgentDir(options.cfg ?? {}, options.agentId),
    };
    const candidates = entries
        .filter((entry) => shouldRetryImageDescription(entry))
        .slice(-maxEntries);
    for (const entry of candidates) {
        const images = Array.isArray(entry?.media?.images) ? entry.media.images.slice(0, maxImagesPerEntry) : [];
        if (images.length === 0) {
            entry.mediaDescriptionsResolved = true;
            continue;
        }
        try {
            const descriptions = [];
            for (const image of images) {
                const described = await describeImageWithOpenClaw(image, runtimeContext);
                if (described) {
                    descriptions.push(truncateAtSentenceBoundary(described, maxChars));
                }
            }
            if (descriptions.length > 0) {
                entry.mediaDescriptions = descriptions;
                entry.body = buildDescribedBody(entry, descriptions);
            }
            entry.mediaDescriptionsResolved = true;
            entry.mediaDescriptionsError = undefined;
        }
        catch (error) {
            entry.mediaDescriptionsResolved = false;
            entry.mediaDescriptionsError = String(error?.message ?? error);
            logger?.warn?.(`[onebot] pending image description failed: ${entry.mediaDescriptionsError}`);
        }
    }
}
