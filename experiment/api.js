var { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { Services } = globalThis || ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs");
var { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
var { AiClassifier } = ChromeUtils.import("resource://aifilter/modules/AiClassifier.jsm");

var aiLog = (...args) => console.log("[ai-filter][api]", ...args);
var setDebug = () => {};

console.log("[ai-filter][api] Experiment API module loading");

var resProto = Cc["@mozilla.org/network/protocol;1?name=resource"]
    .getService(Ci.nsISubstitutingProtocolHandler);

function registerResourceUrl(extension, namespace) {
    aiLog(`[api] registerResourceUrl called for namespace="${namespace}"`, {debug: true});
    if (resProto.hasSubstitution(namespace)) {
        aiLog(`[api] namespace="${namespace}" already registered, skipping`, {debug: true});
        return;
    }
    let uri = Services.io.newURI(".", null, extension.rootURI);
    aiLog(`[api] setting substitution for "${namespace}" → ${uri.spec}`, {debug: true});
    resProto.setSubstitutionWithFlags(namespace, uri, resProto.ALLOW_CONTENT_ACCESS);
}

var AIFilterMod;

var aiFilter = class extends ExtensionCommon.ExtensionAPI {
    async onStartup() {
        let { extension } = this;

        registerResourceUrl(extension, "aifilter");

        // Import logger using the resource URL we just registered
        let loggerMod = ChromeUtils.import("resource://aifilter/modules/logger.jsm");
        aiLog = loggerMod.aiLog;
        setDebug = loggerMod.setDebug;
        aiLog("[api] onStartup()", {debug: true});


        try {
            aiLog("[api] importing ExpressionSearchFilter.jsm", {debug: true});
            AIFilterMod = ChromeUtils.import("resource://aifilter/modules/ExpressionSearchFilter.jsm");
            aiLog("[api] ExpressionSearchFilter.jsm import succeeded", {debug: true});
        }
        catch (err) {
            aiLog("[api] failed to import ExpressionSearchFilter.jsm", {level: 'error'}, err);
        }
    }

    onShutdown(isAppShutdown) {
        aiLog("[api] onShutdown()", {debug: true}, isAppShutdown);
        if (!isAppShutdown && resProto.hasSubstitution("aifilter")) {
            aiLog("[api] removing substitution for namespace='aifilter'", {debug: true});
            resProto.setSubstitution("aifilter", null);
        }
    }

    getAPI(context) {
        aiLog("[api] getAPI()", {debug: true});
        return {
            aiFilter: {
                initConfig: async (config) => {
                    try {
                        AiClassifier.setConfig(config);
                        if (typeof config.debugLogging === "boolean") {
                            setDebug(config.debugLogging);
                        }
                        aiLog("[api] configuration applied", {debug: true}, config);
                    } catch (err) {
                        aiLog("[api] failed to apply config", {level: 'error'}, err);
                    }
                },
                classify: async (text, criterion) => {
                    aiLog("[api] classify() called", {debug: true}, text, criterion);
                    try {
                        return await AiClassifier.classifyText(text, criterion);
                    }
                    catch (err) {
                        aiLog("[api] error in classify()", {level: 'error'}, err);
                        throw err;
                    }
                }
            }
        };
    }
};
