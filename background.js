﻿/*
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
let timingStats = { count: 0, mean: 0, m2: 0, total: 0, last: -1 };
let currentStart = 0;
let logGetTiming = true;
let htmlToMarkdown = false;
let stripUrlParams = false;
let altTextImages = false;
let collapseWhitespace = false;
let TurndownService = null;
let userTheme = 'auto';
let currentTheme = 'light';
let detectSystemTheme;

function normalizeRules(rules) {
    return Array.isArray(rules) ? rules.map(r => {
        if (r.actions) {
            if (!Array.isArray(r.accounts)) r.accounts = [];
            if (!Array.isArray(r.folders)) r.folders = [];
            r.enabled = r.enabled !== false;
            return r;
        }
        const actions = [];
        if (r.tag) actions.push({ type: 'tag', tagKey: r.tag });
        if (r.moveTo) actions.push({ type: 'move', folder: r.moveTo });
        if (r.copyTarget || r.copyTo) actions.push({ type: 'copy', copyTarget: r.copyTarget || r.copyTo });
        const rule = { criterion: r.criterion, actions };
        if (r.stopProcessing) rule.stopProcessing = true;
        if (r.unreadOnly) rule.unreadOnly = true;
        if (typeof r.minAgeDays === 'number') rule.minAgeDays = r.minAgeDays;
        if (typeof r.maxAgeDays === 'number') rule.maxAgeDays = r.maxAgeDays;
        if (Array.isArray(r.accounts)) rule.accounts = r.accounts;
        if (Array.isArray(r.folders)) rule.folders = r.folders;
        rule.enabled = r.enabled !== false;
        return rule;
    }) : [];
}

function iconPaths(name) {
    return {
        16: `resources/img/${name}-${currentTheme}-16.png`,
        32: `resources/img/${name}-${currentTheme}-32.png`,
        64: `resources/img/${name}-${currentTheme}-64.png`
    };
}


const ICONS = {
    logo: () => 'resources/img/logo.png',
    circledots: () => iconPaths('circledots'),
    circle: () => iconPaths('circle'),
    average: () => iconPaths('average')
};

function setIcon(path) {
    if (browser.browserAction) {
        browser.browserAction.setIcon({ path });
    }
    if (browser.messageDisplayAction) {
        browser.messageDisplayAction.setIcon({ path });
    }
}

function updateActionIcon() {
    let path = ICONS.logo();
    if (processing || queuedCount > 0) {
        path = ICONS.circledots();
    }
    setIcon(path);
}

function showTransientIcon(factory, delay = 1500) {
    clearTimeout(iconTimer);
    const path = typeof factory === 'function' ? factory() : factory;
    setIcon(path);
    iconTimer = setTimeout(updateActionIcon, delay);
}

function refreshMenuIcons() {
    browser.menus.update('apply-ai-rules-list', { icons: iconPaths('eye') });
    browser.menus.update('apply-ai-rules-display', { icons: iconPaths('eye') });
    browser.menus.update('clear-ai-cache-list', { icons: iconPaths('trash') });
    browser.menus.update('clear-ai-cache-display', { icons: iconPaths('trash') });
    browser.menus.update('view-ai-reason-list', { icons: iconPaths('clipboarddata') });
    browser.menus.update('view-ai-reason-display', { icons: iconPaths('clipboarddata') });
}


function byteSize(str) {
    return new TextEncoder().encode(str || "").length;
}

function replaceInlineBase64(text) {
    return text.replace(/[A-Za-z0-9+/]{100,}={0,2}/g,
        m => `[base64: ${byteSize(m)} bytes]`);
}

function sanitizeString(text) {
    let t = String(text);
    if (stripUrlParams) {
        t = t.replace(/https?:\/\/[^\s)]+/g, m => {
            const idx = m.indexOf('?');
            return idx >= 0 ? m.slice(0, idx) : m;
        });
    }
    if (collapseWhitespace) {
        t = t.replace(/[ \t\u00A0]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
    }
    return t;
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
        if (altTextImages) {
            doc.querySelectorAll('img').forEach(img => {
                const alt = img.getAttribute('alt') || '';
                img.replaceWith(doc.createTextNode(alt));
            });
        }
        if (stripUrlParams) {
            doc.querySelectorAll('[href]').forEach(a => {
                const href = a.getAttribute('href');
                if (href) a.setAttribute('href', href.split('?')[0]);
            });
            doc.querySelectorAll('[src]').forEach(e => {
                const src = e.getAttribute('src');
                if (src) e.setAttribute('src', src.split('?')[0]);
            });
        }
        if (htmlToMarkdown && TurndownService) {
            try {
                const td = new TurndownService();
                const md = sanitizeString(td.turndown(doc.body.innerHTML || body));
                bodyParts.push(replaceInlineBase64(`[HTML Body converted to Markdown]\n${md}`));
            } catch (e) {
                bodyParts.push(replaceInlineBase64(sanitizeString(doc.body.textContent || "")));
            }
        } else {
            bodyParts.push(replaceInlineBase64(sanitizeString(doc.body.textContent || "")));
        }
    } else {
        bodyParts.push(replaceInlineBase64(sanitizeString(body)));
    }
}

function buildEmailText(full) {
    const bodyParts = [];
    const attachments = [];
    collectText(full, bodyParts, attachments);
    const headers = Object.entries(full.headers || {})
        .map(([k, v]) => `${k}: ${v.join(' ')}`)
        .join('\n');
    const attachInfo = `Attachments: ${attachments.length}` +
        (attachments.length ? "\n" + attachments.map(a => ` - ${a}`).join('\n') : "");
    const combined = `${headers}\n${attachInfo}\n\n${bodyParts.join('\n')}`.trim();
    return sanitizeString(combined);
}

function updateTimingStats(elapsed) {
    const t = timingStats;
    t.count += 1;
    t.total += elapsed;
    t.last = elapsed;
    const delta = elapsed - t.mean;
    t.mean += delta / t.count;
    t.m2 += delta * (elapsed - t.mean);
}

async function getAllMessageIds(list) {
    const ids = [];
    if (!list) {
        return ids;
    }
    let page = list;
    ids.push(...(page.messages || []).map(m => m.id));
    while (page.id) {
        page = await messenger.messages.continueList(page.id);
        ids.push(...(page.messages || []).map(m => m.id));
    }
    return ids;
}

async function processMessage(id) {
    processing = true;
    currentStart = Date.now();
    queuedCount--;
    updateActionIcon();
    try {
        const full = await messenger.messages.getFull(id);
        const text = buildEmailText(full);
        let hdr;
        let currentTags = [];
        let alreadyRead = false;
        let identityId = null;
        try {
            hdr = await messenger.messages.get(id);
            currentTags = Array.isArray(hdr.tags) ? [...hdr.tags] : [];
            alreadyRead = hdr.read === true;
            const ids = await messenger.identities.list(hdr.folder.accountId);
            identityId = ids[0]?.id || null;
        } catch (e) {
            currentTags = [];
            alreadyRead = false;
            identityId = null;
        }

        for (const rule of aiRules) {
            if (rule.enabled === false) {
                continue;
            }
            if (hdr && Array.isArray(rule.accounts) && rule.accounts.length &&
                !rule.accounts.includes(hdr.folder.accountId)) {
                continue;
            }
            if (hdr && Array.isArray(rule.folders) && rule.folders.length &&
                !rule.folders.includes(hdr.folder.path)) {
                continue;
            }
            if (rule.unreadOnly && alreadyRead) {
                continue;
            }
            if (hdr && (typeof rule.minAgeDays === 'number' || typeof rule.maxAgeDays === 'number')) {
                const msgTime = new Date(hdr.date).getTime();
                if (!isNaN(msgTime)) {
                    const ageDays = (Date.now() - msgTime) / 86400000;
                    if (typeof rule.minAgeDays === 'number' && ageDays < rule.minAgeDays) {
                        continue;
                    }
                    if (typeof rule.maxAgeDays === 'number' && ageDays > rule.maxAgeDays) {
                        continue;
                    }
                }
            }
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
                    } else if (act.type === 'copy' && act.copyTarget) {
                        await messenger.messages.copy([id], act.copyTarget);
                    } else if (act.type === 'junk') {
                        await messenger.messages.update(id, { junk: !!act.junk });
                    } else if (act.type === 'read') {
                        await messenger.messages.update(id, { read: !!act.read });
                    } else if (act.type === 'flag') {
                        await messenger.messages.update(id, { flagged: !!act.flagged });
                    } else if (act.type === 'delete') {
                        await messenger.messages.delete([id]);
                    } else if (act.type === 'archive') {
                        await messenger.messages.archive([id]);
                    } else if (act.type === 'forward' && act.address && identityId) {
                        await browser.compose.beginForward(id, { to: [act.address], identityId });
                    } else if (act.type === 'reply' && act.replyType && identityId) {
                        await browser.compose.beginReply(id, { replyType: act.replyType, identityId });
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
        updateTimingStats(elapsed);
        await storage.local.set({ classifyStats: timingStats });
        showTransientIcon(ICONS.circle);
    } catch (e) {
        processing = false;
        const elapsed = Date.now() - currentStart;
        currentStart = 0;
        updateTimingStats(elapsed);
        await storage.local.set({ classifyStats: timingStats });
        logger.aiLog("failed to apply AI rules", { level: 'error' }, e);
        showTransientIcon(ICONS.average);
    }
}
async function applyAiRules(idsInput) {
    const ids = Array.isArray(idsInput) ? idsInput : [idsInput];
    if (!ids.length) return queue;

    if (!aiRules.length) {
        const { aiRules: stored } = await storage.local.get("aiRules");
        aiRules = normalizeRules(stored);
    }

    for (const msg of ids) {
        const id = msg?.id ?? msg;
        queuedCount++;
        updateActionIcon();
        queue = queue.then(() => processMessage(id));
    }

    return queue;
}

async function clearCacheForMessages(idsInput) {
    const ids = Array.isArray(idsInput) ? idsInput : [idsInput];
    if (!ids.length) return;

    if (!aiRules.length) {
        const { aiRules: stored } = await storage.local.get("aiRules");
        aiRules = normalizeRules(stored);
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
        showTransientIcon(ICONS.circle);
    }
}

(async () => {
    logger = await import(browser.runtime.getURL("logger.js"));
    ({ detectSystemTheme } = await import(browser.runtime.getURL('modules/themeUtils.js')));
    try {
        AiClassifier = await import(browser.runtime.getURL("modules/AiClassifier.js"));
        logger.aiLog("AiClassifier imported", { debug: true });
        const td = await import(browser.runtime.getURL("resources/js/turndown.js"));
        TurndownService = td.default || td.TurndownService;
    } catch (e) {
        console.error("failed to import AiClassifier", e);
        return;
    }

    try {
        const store = await storage.local.get(["endpoint", "templateName", "customTemplate", "customSystemPrompt", "aiParams", "debugLogging", "htmlToMarkdown", "stripUrlParams", "altTextImages", "collapseWhitespace", "aiRules", "theme"]);
        logger.setDebug(store.debugLogging);
        await AiClassifier.setConfig(store);
        userTheme = store.theme || 'auto';
        currentTheme = userTheme === 'auto' ? await detectSystemTheme() : userTheme;
        await AiClassifier.init();
        htmlToMarkdown = store.htmlToMarkdown === true;
        stripUrlParams = store.stripUrlParams === true;
        altTextImages = store.altTextImages === true;
        collapseWhitespace = store.collapseWhitespace === true;
        const savedStats = await storage.local.get('classifyStats');
        if (savedStats.classifyStats && typeof savedStats.classifyStats === 'object') {
            Object.assign(timingStats, savedStats.classifyStats);
        }
        if (typeof timingStats.last !== 'number') {
            timingStats.last = -1;
        }
        aiRules = normalizeRules(store.aiRules);
        logger.aiLog("configuration loaded", { debug: true }, store);
        storage.onChanged.addListener(async changes => {
            if (changes.aiRules) {
                const newRules = changes.aiRules.newValue || [];
                aiRules = normalizeRules(newRules);
                logger.aiLog("aiRules updated from storage change", { debug: true }, aiRules);
            }
            if (changes.htmlToMarkdown) {
                htmlToMarkdown = changes.htmlToMarkdown.newValue === true;
                logger.aiLog("htmlToMarkdown updated from storage change", { debug: true }, htmlToMarkdown);
            }
            if (changes.stripUrlParams) {
                stripUrlParams = changes.stripUrlParams.newValue === true;
                logger.aiLog("stripUrlParams updated from storage change", { debug: true }, stripUrlParams);
            }
            if (changes.altTextImages) {
                altTextImages = changes.altTextImages.newValue === true;
                logger.aiLog("altTextImages updated from storage change", { debug: true }, altTextImages);
            }
            if (changes.collapseWhitespace) {
                collapseWhitespace = changes.collapseWhitespace.newValue === true;
                logger.aiLog("collapseWhitespace updated from storage change", { debug: true }, collapseWhitespace);
            }
            if (changes.theme) {
                userTheme = changes.theme.newValue || 'auto';
                currentTheme = userTheme === 'auto' ? await detectSystemTheme() : userTheme;
                updateActionIcon();
                refreshMenuIcons();
            }
        });

        if (browser.theme?.onUpdated) {
            browser.theme.onUpdated.addListener(async () => {
                if (userTheme === 'auto') {
                    const theme = await detectSystemTheme();
                    if (theme !== currentTheme) {
                        currentTheme = theme;
                        updateActionIcon();
                        refreshMenuIcons();
                    }
                }
            });
        }
    } catch (err) {
        logger.aiLog("failed to load config", { level: 'error' }, err);
    }

    logger.aiLog("background.js loaded – ready to classify", { debug: true });
    updateActionIcon();
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
        icons: iconPaths('eye')
    });
    browser.menus.create({
        id: "apply-ai-rules-display",
        title: "Apply AI Rules",
        contexts: ["message_display_action"],
        icons: iconPaths('eye')
    });
    browser.menus.create({
        id: "clear-ai-cache-list",
        title: "Clear AI Cache",
        contexts: ["message_list"],
        icons: iconPaths('trash')
    });
    browser.menus.create({
        id: "clear-ai-cache-display",
        title: "Clear AI Cache",
        contexts: ["message_display_action"],
        icons: iconPaths('trash')
    });
    browser.menus.create({
        id: "view-ai-reason-list",
        title: "View Reasoning",
        contexts: ["message_list"],
        icons: iconPaths('clipboarddata')
    });
    browser.menus.create({
        id: "view-ai-reason-display",
        title: "View Reasoning",
        contexts: ["message_display_action"],
        icons: iconPaths('clipboarddata')
    });
    refreshMenuIcons();

    browser.menus.onClicked.addListener(async (info, tab) => {
        if (info.menuItemId === "apply-ai-rules-list" || info.menuItemId === "apply-ai-rules-display") {
            let ids = info.messageId ? [info.messageId] : [];
            if (info.selectedMessages) {
                ids = await getAllMessageIds(info.selectedMessages);
            }
            await applyAiRules(ids);
        } else if (info.menuItemId === "clear-ai-cache-list" || info.menuItemId === "clear-ai-cache-display") {
            let ids = info.messageId ? [info.messageId] : [];
            if (info.selectedMessages) {
                ids = await getAllMessageIds(info.selectedMessages);
            }
            await clearCacheForMessages(ids);
        } else if (info.menuItemId === "view-ai-reason-list" || info.menuItemId === "view-ai-reason-display") {
            const [header] = await browser.messageDisplay.getDisplayedMessages(tab.id);
            if (!header) { return; }

            const url = `${browser.runtime.getURL("details.html")}?mid=${header.id}`;

            await browser.tabs.create({ url });
        }
    });

    // Listen for messages from UI/devtools
    browser.runtime.onMessage.addListener(async (msg) => {
        if ((msg?.type === "sortana:getTiming" && logGetTiming) || (msg?.type !== "sortana:getTiming")) {
            logGetTiming = false;
            logger.aiLog("onMessage received", { debug: true }, msg);
        }

        if (msg?.type === "sortana:test") {
            const { text = "", criterion = "" } = msg;
            logger.aiLog("sortana:test – text", { debug: true }, text);
            logger.aiLog("sortana:test – criterion", { debug: true }, criterion);

            try {
                logger.aiLog("Calling AiClassifier.classifyText()", { debug: true });
                const result = await AiClassifier.classifyText(text, criterion);
                logger.aiLog("classify() returned", { debug: true }, result);
                return { match: result };
            }
            catch (err) {
                logger.aiLog("Error in classify()", { level: 'error' }, err);
                // rethrow so the caller sees the failure
                throw err;
            }
        } else if (msg?.type === "sortana:clearCacheForDisplayed") {
            try {
                const msgs = await browser.messageDisplay.getDisplayedMessages();
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
                    aiRules = normalizeRules(stored);
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
                    aiRules = normalizeRules(stored);
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
        } else if (msg?.type === "sortana:getDisplayedMessages") {
            try {
                const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
                const messages = await browser.messageDisplay.getDisplayedMessages(tab?.id);
                const ids = messages.map(hdr => hdr.id);

                return { ids };
            } catch (e) {
                logger.aiLog("failed to get displayed messages", { level: 'error' }, e);
                return { messages: [] };
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
                last: t.last,
                runs: t.count,
                average: t.mean,
                total: t.total,
                stddev: std
            };
        } else {
            logger.aiLog("Unknown message type, ignoring", { level: 'warn' }, msg?.type);
        }
    });

    // Automatically classify new messages
    if (typeof messenger !== "undefined" && messenger.messages?.onNewMailReceived) {
        messenger.messages.onNewMailReceived.addListener(async (folder, messages) => {
            logger.aiLog("onNewMailReceived", { debug: true }, messages);
            const ids = (messages?.messages || messages || []).map(m => m.id ?? m);
            await applyAiRules(ids);
        });
    } else {
        logger.aiLog("messenger.messages API unavailable, skipping new mail listener", { level: 'warn' });
    }

    // Catch any unhandled rejections
    window.addEventListener("unhandledrejection", ev => {
        logger.aiLog("Unhandled promise rejection", { level: 'error' }, ev.reason);
    });

    browser.runtime.onInstalled.addListener(async ({ reason }) => {
        if (reason === "install") {
            await browser.runtime.openOptionsPage();
        }
    });

})();
