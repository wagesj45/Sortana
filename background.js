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

// Startup
console.log("[ai-filter] background.js loaded – ready to classify");
(async () => {
    try {
        const store = await browser.storage.local.get(["endpoint", "templateName", "customTemplate", "customSystemPrompt"]);
        await browser.aiFilter.initConfig(store);
        console.log("[ai-filter] configuration loaded", store);
        try {
            await browser.DomContentScript.registerWindow(
                "chrome://messenger/content/FilterEditor.xhtml",
                "resource://aifilter/content/filterEditor.js"
            );
            console.log("[ai-filter] registered FilterEditor content script");
        } catch (e) {
            console.error("[ai-filter] failed to register content script", e);
        }
    } catch (err) {
        console.error("[ai-filter] failed to load config:", err);
    }
})();

// Listen for messages from UI/devtools
browser.runtime.onMessage.addListener((msg) => {
    console.log("[ai-filter] onMessage received:", msg);

    if (msg?.type === "aiFilter:test") {
        const { text = "", criterion = "" } = msg;
        console.log("[ai-filter] aiFilter:test – text:", text);
        console.log("[ai-filter] aiFilter:test – criterion:", criterion);

        try {
            console.log("[ai-filter] Calling browser.aiFilter.classify()");
            const result = browser.aiFilter.classify(text, criterion);
            console.log("[ai-filter] classify() returned:", result);
            return { match: result };
        }
        catch (err) {
            console.error("[ai-filter] Error in classify():", err);
            // rethrow so the caller sees the failure
            throw err;
        }
    }
    else {
        console.warn("[ai-filter] Unknown message type, ignoring:", msg?.type);
    }
});

// Catch any unhandled rejections
window.addEventListener("unhandledrejection", ev => {
    console.error("[ai-filter] Unhandled promise rejection:", ev.reason);
});

browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === "install") {
        await browser.runtime.openOptionsPage();
    }
});
