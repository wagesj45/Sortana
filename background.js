/*
 * Runs in the **WebExtension (addon)** context.
 * For this minimal working version we only expose an async helper
 * so UI pages / devtools panels can test the classifier without
 * needing Thunderbird’s filter engine.
 *
 * Note: the filter-engine itself NEVER calls this file – the
 * synchronous work is all done in experiment/api.js (chrome side).
 */

"use strict";

const storage = (globalThis.messenger ?? browser).storage;

let logger;
let AiClassifier;
let aiRules = [];
let queue = Promise.resolve();
let queuedCount = 0;
let processing = false;
let iconTimer = null;
let timingStats = { count: 0, mean: 0, m2: 0, total: 0 };
let currentStart = 0;

function setIcon(path) {
    if (browser.browserAction) {
        browser.browserAction.setIcon({ path });
    }
    if (browser.messageDisplayAction) {
        browser.messageDisplayAction.setIcon({ path });
    }
}

function updateActionIcon() {
    let path = "resources/img/brain.png";
    if (processing || queuedCount > 0) {
        path = "resources/img/busy.png";
    }
    setIcon(path);
}

function showTransientIcon(path, delay = 1500) {
    clearTimeout(iconTimer);
    setIcon(path);
    iconTimer = setTimeout(updateActionIcon, delay);
}


function byteSize(str) {
    return new TextEncoder().encode(str || "").length;
}

function replaceInlineBase64(text) {
    return text.replace(/[A-Za-z0-9+/]{100,}={0,2}/g,
        m => `[base64: ${byteSize(m)} bytes]`);
}

function collectText(part, bodyParts, attachments) {
    if (part.parts && part.parts.length) {
        for (const p of part.parts) collectText(p, bodyParts, attachments);
        return;
    }
    const ct = (part.contentType || "text/plain").toLowerCase();
    const cd = (part.headers?.["content-disposition"]?.[0] || "").toLowerCase();
    const body = String(part.body || "");
    if (cd.includes("attachment") || !ct.startsWith("text/")) {
        const nameMatch = /filename\s*=\s*"?([^";]+)/i.exec(cd) || /name\s*=\s*"?([^";]+)/i.exec(part.headers?.["content-type"]?.[0] || "");
        const name = nameMatch ? nameMatch[1] : "";
        attachments.push(`${name} (${ct}, ${part.size || byteSize(body)} bytes)`);
    } else if (ct.startsWith("text/html")) {
        const doc = new DOMParser().parseFromString(body, 'text/html');
        bodyParts.push(replaceInlineBase64(doc.body.textContent || ""));
    } else {
        bodyParts.push(replaceInlineBase64(body));
    }
}

function buildEmailText(full) {
    const bodyParts = [];
    const attachments = [];
    collectText(full, bodyParts, attachments);
    const headers = Object.entries(full.headers || {})
        .map(([k,v]) => `${k}: ${v.join(' ')}`)
        .join('\n');
    const attachInfo = `Attachments: ${attachments.length}` + (attachments.length ? "\n" + attachments.map(a => ` - ${a}`).join('\n') : "");
    return `${headers}\n${attachInfo}\n\n${bodyParts.join('\n')}`.trim();
}
async function applyAiRules(idsInput) {
    const ids = Array.isArray(idsInput) ? idsInput : [idsInput];
    if (!ids.length) return queue;

    if (!aiRules.length) {
        const { aiRules: stored } = await storage.local.get("aiRules");
        aiRules = Array.isArray(stored) ? stored.map(r => {
            if (r.actions) return r;
            const actions = [];
            if (r.tag) actions.push({ type: 'tag', tagKey: r.tag });
            if (r.moveTo) actions.push({ type: 'move', folder: r.moveTo });
            const rule = { criterion: r.criterion, actions };
            if (r.stopProcessing) rule.stopProcessing = true;
            return rule;
        }) : [];
    }

    for (const msg of ids) {
        const id = msg?.id ?? msg;
        queuedCount++;
        updateActionIcon();
        queue = queue.then(async () => {
            processing = true;
            currentStart = Date.now();
            queuedCount--;
            updateActionIcon();
            try {
                const full = await messenger.messages.getFull(id);
                const text = buildEmailText(full);
                let currentTags = [];
                try {
                    const hdr = await messenger.messages.get(id);
                    currentTags = Array.isArray(hdr.tags) ? [...hdr.tags] : [];
                } catch (e) {
                    currentTags = [];
                }

                for (const rule of aiRules) {
                    const cacheKey = await AiClassifier.buildCacheKey(id, rule.criterion);
                    const matched = await AiClassifier.classifyText(text, rule.criterion, cacheKey);
                    if (matched) {
                        for (const act of (rule.actions || [])) {
                            if (act.type === 'tag' && act.tagKey) {
                                if (!currentTags.includes(act.tagKey)) {
                                    currentTags.push(act.tagKey);
                                    await messenger.messages.update(id, { tags: currentTags });
                                }
                            } else if (act.type === 'move' && act.folder) {
                                await messenger.messages.move([id], act.folder);
                            } else if (act.type === 'junk') {
                                await messenger.messages.update(id, { junk: !!act.junk });
                            }
                        }
                        if (rule.stopProcessing) {
                            break;
                        }
                    }
                }
                processing = false;
                const elapsed = Date.now() - currentStart;
                currentStart = 0;
                const t = timingStats;
                t.count += 1;
                t.total += elapsed;
                const delta = elapsed - t.mean;
                t.mean += delta / t.count;
                t.m2 += delta * (elapsed - t.mean);
                await storage.local.set({ classifyStats: t });
                showTransientIcon("resources/img/done.png");
            } catch (e) {
                processing = false;
                const elapsed = Date.now() - currentStart;
                currentStart = 0;
                const t = timingStats;
                t.count += 1;
                t.total += elapsed;
                const delta = elapsed - t.mean;
                t.mean += delta / t.count;
                t.m2 += delta * (elapsed - t.mean);
                await storage.local.set({ classifyStats: t });
                logger.aiLog("failed to apply AI rules", { level: 'error' }, e);
                showTransientIcon("resources/img/error.png");
            }
        });
    }

    return queue;
}

async function clearCacheForMessages(idsInput) {
    const ids = Array.isArray(idsInput) ? idsInput : [idsInput];
    if (!ids.length) return;

    if (!aiRules.length) {
        const { aiRules: stored } = await storage.local.get("aiRules");
        aiRules = Array.isArray(stored) ? stored.map(r => {
            if (r.actions) return r;
            const actions = [];
            if (r.tag) actions.push({ type: 'tag', tagKey: r.tag });
            if (r.moveTo) actions.push({ type: 'move', folder: r.moveTo });
            const rule = { criterion: r.criterion, actions };
            if (r.stopProcessing) rule.stopProcessing = true;
            return rule;
        }) : [];
    }

    const keys = [];
    for (const msg of ids) {
        const id = msg?.id ?? msg;
        for (const rule of aiRules) {
            const key = await AiClassifier.buildCacheKey(id, rule.criterion);
            keys.push(key);
        }
    }
    if (keys.length) {
        await AiClassifier.removeCacheEntries(keys);
        showTransientIcon("resources/img/done.png");
    }
}

(async () => {
    logger = await import(browser.runtime.getURL("logger.js"));
    try {
        AiClassifier = await import(browser.runtime.getURL("modules/AiClassifier.js"));
        logger.aiLog("AiClassifier imported", {debug: true});
    } catch (e) {
        console.error("failed to import AiClassifier", e);
        return;
    }

    try {
        const store = await storage.local.get(["endpoint", "templateName", "customTemplate", "customSystemPrompt", "aiParams", "debugLogging", "aiRules"]);
        logger.setDebug(store.debugLogging);
        await AiClassifier.setConfig(store);
        await AiClassifier.init();
        const savedStats = await storage.local.get('classifyStats');
        if (savedStats.classifyStats && typeof savedStats.classifyStats === 'object') {
            Object.assign(timingStats, savedStats.classifyStats);
        }
        aiRules = Array.isArray(store.aiRules) ? store.aiRules.map(r => {
            if (r.actions) return r;
            const actions = [];
            if (r.tag) actions.push({ type: 'tag', tagKey: r.tag });
            if (r.moveTo) actions.push({ type: 'move', folder: r.moveTo });
            const rule = { criterion: r.criterion, actions };
            if (r.stopProcessing) rule.stopProcessing = true;
            return rule;
        }) : [];
        logger.aiLog("configuration loaded", {debug: true}, store);
        storage.onChanged.addListener(async changes => {
            if (changes.aiRules) {
                const newRules = changes.aiRules.newValue || [];
                aiRules = newRules.map(r => {
                    if (r.actions) return r;
                    const actions = [];
                    if (r.tag) actions.push({ type: 'tag', tagKey: r.tag });
                    if (r.moveTo) actions.push({ type: 'move', folder: r.moveTo });
                    const rule = { criterion: r.criterion, actions };
                    if (r.stopProcessing) rule.stopProcessing = true;
                    return rule;
                });
                logger.aiLog("aiRules updated from storage change", {debug: true}, aiRules);
            }
        });
    } catch (err) {
        logger.aiLog("failed to load config", {level: 'error'}, err);
    }

    logger.aiLog("background.js loaded – ready to classify", {debug: true});
    if (browser.messageDisplayAction) {
        browser.messageDisplayAction.setTitle({ title: "Details" });
        if (browser.messageDisplayAction.setLabel) {
            browser.messageDisplayAction.setLabel({ label: "Details" });
        }
    }

    browser.menus.create({
        id: "apply-ai-rules-list",
        title: "Apply AI Rules",
        contexts: ["message_list"],
    });
    browser.menus.create({
        id: "apply-ai-rules-display",
        title: "Apply AI Rules",
        contexts: ["message_display_action"],
    });
    browser.menus.create({
        id: "clear-ai-cache-list",
        title: "Clear AI Cache",
        contexts: ["message_list"],
    });
    browser.menus.create({
        id: "clear-ai-cache-display",
        title: "Clear AI Cache",
        contexts: ["message_display_action"],
    });
    browser.menus.create({
        id: "view-ai-reason-list",
        title: "View Reasoning",
        contexts: ["message_list"],
        icons: { "16": "resources/img/brain.png" }
    });
    browser.menus.create({
        id: "view-ai-reason-display",
        title: "View Reasoning",
        contexts: ["message_display_action"],
        icons: { "16": "resources/img/brain.png" }
    });



    browser.menus.onClicked.addListener(async info => {
        if (info.menuItemId === "apply-ai-rules-list" || info.menuItemId === "apply-ai-rules-display") {
            const ids = info.selectedMessages?.messages?.map(m => m.id) ||
                         (info.messageId ? [info.messageId] : []);
            await applyAiRules(ids);
        } else if (info.menuItemId === "clear-ai-cache-list" || info.menuItemId === "clear-ai-cache-display") {
            const ids = info.selectedMessages?.messages?.map(m => m.id) ||
                         (info.messageId ? [info.messageId] : []);
            await clearCacheForMessages(ids);
        } else if (info.menuItemId === "view-ai-reason-list" || info.menuItemId === "view-ai-reason-display") {
            const id = info.messageId || info.selectedMessages?.messages?.[0]?.id;
            if (id) {
                const url = browser.runtime.getURL(`details.html?mid=${id}`);
                browser.tabs.create({ url });
            }
        }
    });

    // Listen for messages from UI/devtools
    browser.runtime.onMessage.addListener(async (msg) => {
        logger.aiLog("onMessage received", {debug: true}, msg);

    if (msg?.type === "aiFilter:test") {
        const { text = "", criterion = "" } = msg;
        logger.aiLog("aiFilter:test – text", {debug: true}, text);
        logger.aiLog("aiFilter:test – criterion", {debug: true}, criterion);

        try {
            logger.aiLog("Calling AiClassifier.classifyText()", {debug: true});
            const result = await AiClassifier.classifyText(text, criterion);
            logger.aiLog("classify() returned", {debug: true}, result);
            return { match: result };
        }
        catch (err) {
            logger.aiLog("Error in classify()", {level: 'error'}, err);
            // rethrow so the caller sees the failure
            throw err;
        }
    } else if (msg?.type === "sortana:clearCacheForDisplayed") {
        try {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            const tabId = tabs[0]?.id;
            const msgs = tabId ? await browser.messageDisplay.getDisplayedMessages(tabId) : [];
            const ids = msgs.map(m => m.id);
            await clearCacheForMessages(ids);
        } catch (e) {
            logger.aiLog("failed to clear cache from message script", { level: 'error' }, e);
        }
    } else if (msg?.type === "sortana:getReasons") {
        try {
            const id = msg.id;
            const hdr = await messenger.messages.get(id);
            const subject = hdr?.subject || "";
            if (!aiRules.length) {
                const { aiRules: stored } = await storage.local.get("aiRules");
                aiRules = Array.isArray(stored) ? stored.map(r => {
                    if (r.actions) return r;
                    const actions = [];
                    if (r.tag) actions.push({ type: 'tag', tagKey: r.tag });
                    if (r.moveTo) actions.push({ type: 'move', folder: r.moveTo });
                    const rule = { criterion: r.criterion, actions };
                    if (r.stopProcessing) rule.stopProcessing = true;
                    return rule;
                }) : [];
            }
            const reasons = [];
            for (const rule of aiRules) {
                const key = await AiClassifier.buildCacheKey(id, rule.criterion);
                const reason = AiClassifier.getReason(key);
                if (reason) {
                    reasons.push({ criterion: rule.criterion, reason });
                }
            }
            return { subject, reasons };
        } catch (e) {
            logger.aiLog("failed to collect reasons", { level: 'error' }, e);
            return { subject: '', reasons: [] };
        }
    } else if (msg?.type === "sortana:getDetails") {
        try {
            const id = msg.id;
            const hdr = await messenger.messages.get(id);
            const subject = hdr?.subject || "";
            if (!aiRules.length) {
                const { aiRules: stored } = await storage.local.get("aiRules");
                aiRules = Array.isArray(stored) ? stored.map(r => {
                    if (r.actions) return r;
                    const actions = [];
                    if (r.tag) actions.push({ type: 'tag', tagKey: r.tag });
                    if (r.moveTo) actions.push({ type: 'move', folder: r.moveTo });
                    const rule = { criterion: r.criterion, actions };
                    if (r.stopProcessing) rule.stopProcessing = true;
                    return rule;
                }) : [];
            }
            const results = [];
            for (const rule of aiRules) {
                const key = await AiClassifier.buildCacheKey(id, rule.criterion);
                const matched = AiClassifier.getCachedResult(key);
                const reason = AiClassifier.getReason(key);
                if (matched !== null || reason) {
                    results.push({ criterion: rule.criterion, matched, reason });
                }
            }
            return { subject, results };
        } catch (e) {
            logger.aiLog("failed to collect details", { level: 'error' }, e);
            return { subject: '', results: [] };
        }
    } else if (msg?.type === "sortana:clearCacheForMessage") {
        try {
            await clearCacheForMessages([msg.id]);
            return { ok: true };
        } catch (e) {
            logger.aiLog("failed to clear cache for message", { level: 'error' }, e);
            return { ok: false };
        }
    } else if (msg?.type === "sortana:getQueueCount") {
        return { count: queuedCount + (processing ? 1 : 0) };
    } else if (msg?.type === "sortana:getTiming") {
        const t = timingStats;
        const std = t.count > 1 ? Math.sqrt(t.m2 / (t.count - 1)) : 0;
        return {
            count: queuedCount + (processing ? 1 : 0),
            current: currentStart ? Date.now() - currentStart : -1,
            average: t.mean,
            total: t.total,
            stddev: std
        };
    } else {
        logger.aiLog("Unknown message type, ignoring", {level: 'warn'}, msg?.type);
    }
});

// Automatically classify new messages
if (typeof messenger !== "undefined" && messenger.messages?.onNewMailReceived) {
    messenger.messages.onNewMailReceived.addListener(async (folder, messages) => {
        logger.aiLog("onNewMailReceived", {debug: true}, messages);
        const ids = (messages?.messages || messages || []).map(m => m.id ?? m);
        await applyAiRules(ids);
    });
} else {
    logger.aiLog("messenger.messages API unavailable, skipping new mail listener", { level: 'warn' });
}

// Catch any unhandled rejections
window.addEventListener("unhandledrejection", ev => {
    logger.aiLog("Unhandled promise rejection", {level: 'error'}, ev.reason);
});

    browser.runtime.onInstalled.addListener(async ({ reason }) => {
        if (reason === "install") {
            await browser.runtime.openOptionsPage();
        }
    });

})();
