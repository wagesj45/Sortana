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
// Startup
(async () => {
    logger = await import(browser.runtime.getURL("logger.js"));
    logger.aiLog("background.js loaded – ready to classify", {debug: true});
    try {
        const store = await browser.storage.local.get(["endpoint", "templateName", "customTemplate", "customSystemPrompt", "aiParams", "debugLogging"]);
        logger.setDebug(store.debugLogging);
        await browser.aiFilter.initConfig(store);
        logger.aiLog("configuration loaded", {debug: true}, store);
        try {
            await browser.DomContentScript.registerWindow(
                "chrome://messenger/content/FilterEditor.xhtml",
                "resource://aifilter/content/filterEditor.js"
            );
            logger.aiLog("registered FilterEditor content script", {debug: true});
        } catch (e) {
            logger.aiLog("failed to register content script", {level: 'error'}, e);
        }
    } catch (err) {
        logger.aiLog("failed to load config", {level: 'error'}, err);
    }
})();

// Listen for messages from UI/devtools
browser.runtime.onMessage.addListener((msg) => {
    logger.aiLog("onMessage received", {debug: true}, msg);

    if (msg?.type === "aiFilter:test") {
        const { text = "", criterion = "" } = msg;
        logger.aiLog("aiFilter:test – text", {debug: true}, text);
        logger.aiLog("aiFilter:test – criterion", {debug: true}, criterion);

        try {
            logger.aiLog("Calling browser.aiFilter.classify()", {debug: true});
            const result = browser.aiFilter.classify(text, criterion);
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

// Catch any unhandled rejections
window.addEventListener("unhandledrejection", ev => {
    logger.aiLog("Unhandled promise rejection", {level: 'error'}, ev.reason);
});

browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === "install") {
        await browser.runtime.openOptionsPage();
    }
});
