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

let logger;
let AiClassifier;
let aiRules = [];

async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
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
        const store = await browser.storage.local.get(["endpoint", "templateName", "customTemplate", "customSystemPrompt", "aiParams", "debugLogging", "aiRules"]);
        logger.setDebug(store.debugLogging);
        await AiClassifier.setConfig(store);
        aiRules = Array.isArray(store.aiRules) ? store.aiRules : [];
        logger.aiLog("configuration loaded", {debug: true}, store);
    } catch (err) {
        logger.aiLog("failed to load config", {level: 'error'}, err);
    }

    logger.aiLog("background.js loaded – ready to classify", {debug: true});

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
    }
    else {
        logger.aiLog("Unknown message type, ignoring", {level: 'warn'}, msg?.type);
    }
});

// Automatically classify new messages
if (typeof messenger !== "undefined" && messenger.messages?.onNewMailReceived) {
    messenger.messages.onNewMailReceived.addListener(async (folder, messages) => {
        logger.aiLog("onNewMailReceived", {debug: true}, messages);
        if (!aiRules.length) {
            const { aiRules: stored } = await browser.storage.local.get("aiRules");
            aiRules = Array.isArray(stored) ? stored : [];
        }
        for (const msg of (messages?.messages || messages || [])) {
            const id = msg.id ?? msg;
            try {
                const full = await messenger.messages.getFull(id);
                const text = full?.parts?.[0]?.body || "";
                for (const rule of aiRules) {
                    const cacheKey = await sha256Hex(`${id}|${rule.criterion}`);
                    const matched = await AiClassifier.classifyText(text, rule.criterion, cacheKey);
                    if (matched) {
                        if (rule.tag) {
                            await messenger.messages.update(id, {tags: [rule.tag]});
                        }
                        if (rule.moveTo) {
                            await messenger.messages.move([id], rule.moveTo);
                        }
                    }
                }
            } catch (e) {
                logger.aiLog("failed to classify new mail", {level: 'error'}, e);
            }
        }
    });
} else {
    logger.aiLog("messenger.messages API unavailable, skipping new mail listener", {level: 'warn'});
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
