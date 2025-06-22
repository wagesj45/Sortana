"use strict";
var { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
var { MailServices }    = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
var { Services }        = globalThis || ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs");
var { NetUtil }         = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
var { MimeParser }      = ChromeUtils.importESModule("resource:///modules/mimeParser.sys.mjs");
var { FileUtils }       = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");
var { aiLog, setDebug } = ChromeUtils.import("resource://aifilter/modules/logger.jsm");

function sha256Hex(str) {
  const hasher = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
  hasher.init(Ci.nsICryptoHash.SHA256);
  const data = new TextEncoder().encode(str);
  hasher.update(data, data.length);
  const binary = hasher.finish(false);
  return Array.from(binary, c => ("0" + c.charCodeAt(0).toString(16)).slice(-2)).join("");
}

var EXPORTED_SYMBOLS = ["AIFilter", "ClassificationTerm"];

const SYSTEM_PREFIX = `You are an email-classification assistant.
Read the email below and the classification criterion provided by the user.
`;

const DEFAULT_CUSTOM_SYSTEM_PROMPT = "Determine whether the email satisfies the user's criterion.";

const SYSTEM_SUFFIX = `
Return ONLY a JSON object on a single line of the form:
{"match": true} - if the email satisfies the criterion
{"match": false} - otherwise

Do not add any other keys, text, or formatting.`;

class CustomerTermBase {
  constructor(nameId, operators) {
    // Lookup our extension instance using the ID from manifest.json
    // so locale strings are resolved correctly.
    this.extension = ExtensionParent.GlobalManager.getExtension("ai-filter@jordanwages");
    this.id = "aifilter#" + nameId;
    this.name = this.extension.localeData.localizeMessage(nameId);
    this.operators = operators;
    this.cache = new Map();
    this._cacheFile = Services.dirsvc.get("ProfD", Ci.nsIFile);
    this._cacheFile.append("aifilter_cache.json");
    this._loadCache();

    aiLog(`[ExpressionSearchFilter] Initialized term base "${this.id}"`, {debug: true});
  }

  _loadCache() {
    aiLog(`[ExpressionSearchFilter] Loading cache from ${this._cacheFile.path}` , {debug: true});
    try {
      if (this._cacheFile.exists()) {
        let stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
        stream.init(this._cacheFile, -1, 0, 0);
        let data = NetUtil.readInputStreamToString(stream, stream.available());
        stream.close();
        aiLog(`[ExpressionSearchFilter] Cache file contents: ${data}`, {debug: true});
        let obj = JSON.parse(data);
        for (let [k, v] of Object.entries(obj)) {
          aiLog(`[ExpressionSearchFilter] ⮡ Loaded entry '${k}' → ${v}`, {debug: true});
          this.cache.set(k, v);
        }
        aiLog(`[ExpressionSearchFilter] Loaded ${this.cache.size} cache entries`, {debug: true});
      } else {
        aiLog(`[ExpressionSearchFilter] Cache file does not exist`, {debug: true});
      }
    } catch (e) {
      aiLog(`Failed to load cache`, {level: 'error'}, e);
    }
  }

  _saveCache(updatedKey, updatedValue) {
    aiLog(`[ExpressionSearchFilter] Saving cache to ${this._cacheFile.path}`, {debug: true});
    if (typeof updatedKey !== "undefined") {
      aiLog(`[ExpressionSearchFilter] ⮡ Persisting entry '${updatedKey}' → ${updatedValue}`, {debug: true});
    }
    try {
      let obj = Object.fromEntries(this.cache);
      let data = JSON.stringify(obj);
      let stream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      stream.init(this._cacheFile,
                  FileUtils.MODE_WRONLY | FileUtils.MODE_CREATE | FileUtils.MODE_TRUNCATE,
                  FileUtils.PERMS_FILE,
                  0);
      stream.write(data, data.length);
      stream.close();
    } catch (e) {
      aiLog(`Failed to save cache`, {level: 'error'}, e);
    }
  }

  getEnabled() {
    aiLog(`[ExpressionSearchFilter] getEnabled() called on "${this.id}"`, {debug: true});
    return true;
  }

  getAvailable() {
    aiLog(`[ExpressionSearchFilter] getAvailable() called on "${this.id}"`, {debug: true});
    return true;
  }

  getAvailableOperators() {
    aiLog(`[ExpressionSearchFilter] getAvailableOperators() called on "${this.id}"`, {debug: true});
    return this.operators;
  }

  getAvailableValues() {
    aiLog(`[ExpressionSearchFilter] getAvailableValues() called on "${this.id}"`, {debug: true});
    return null;
  }

  get attrib() {
    aiLog(`[ExpressionSearchFilter] attrib getter called for "${this.id}"`, {debug: true});

    //return Ci.nsMsgSearchAttrib.Custom;
  }
}

function getPlainText(msgHdr) {
  aiLog(`[ExpressionSearchFilter] Extracting plain text for message ID ${msgHdr.messageId}`, {debug: true});
  let folder = msgHdr.folder;
  if (!folder.getMsgInputStream) return "";
  let reusable = {};
  let stream = folder.getMsgInputStream(msgHdr, reusable);
  let data = NetUtil.readInputStreamToString(stream, msgHdr.messageSize);
  if (!reusable.value) stream.close();
  let parser = Cc["@mozilla.org/parserutils;1"].getService(Ci.nsIParserUtils);
  return parser.convertToPlainText(data,
    Ci.nsIDocumentEncoder.OutputLFLineBreak |
    Ci.nsIDocumentEncoder.OutputNoScriptContent |
    Ci.nsIDocumentEncoder.OutputNoFramesContent |
    Ci.nsIDocumentEncoder.OutputBodyOnly, 0);
}

let gEndpoint = "http://127.0.0.1:5000/v1/classify";
let gTemplateName = "openai";
let gCustomTemplate = "";
let gCustomSystemPrompt = DEFAULT_CUSTOM_SYSTEM_PROMPT;
let gTemplateText = "";

let gAiParams = {
  max_tokens: 4096,
  temperature: 0.6,
  top_p: 0.95,
  seed: -1,
  repetition_penalty: 1.0,
  top_k: 20,
  min_p: 0,
  presence_penalty: 0,
  frequency_penalty: 0,
  typical_p: 1,
  tfs: 1,
};

function loadTemplate(name) {
  try {
    let url = `resource://aifilter/prompt_templates/${name}.txt`;
    let xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.overrideMimeType("text/plain");
    xhr.send();
    if (xhr.status === 0 || xhr.status === 200) {
      return xhr.responseText;
    }
  } catch (e) {
    aiLog(`Failed to load template '${name}':`, {level: 'error'}, e);
  }
  return "";
}

function setConfig(config = {}) {
    if (config.endpoint) {
        gEndpoint = config.endpoint;
    }
    if (config.templateName) {
        gTemplateName = config.templateName;
    }
    if (typeof config.customTemplate === "string") {
        gCustomTemplate = config.customTemplate;
    }
    if (typeof config.customSystemPrompt === "string") {
        gCustomSystemPrompt = config.customSystemPrompt;
    }
    if (config.aiParams && typeof config.aiParams === "object") {
        for (let [k, v] of Object.entries(config.aiParams)) {
            if (k in gAiParams && typeof v !== "undefined") {
                gAiParams[k] = v;
            }
        }
    }
    if (typeof config.debugLogging === "boolean") {
        setDebug(config.debugLogging);
    }
    gTemplateText = gTemplateName === "custom" ? gCustomTemplate : loadTemplate(gTemplateName);
    aiLog(`[ExpressionSearchFilter] Endpoint set to ${gEndpoint}`, {debug: true});
    aiLog(`[ExpressionSearchFilter] Template set to ${gTemplateName}`, {debug: true});
}

function buildSystemPrompt() {
  return SYSTEM_PREFIX + (gCustomSystemPrompt || DEFAULT_CUSTOM_SYSTEM_PROMPT) + SYSTEM_SUFFIX;
}

function buildPrompt(body, criterion) {
  aiLog(`[ExpressionSearchFilter] Building prompt with criterion: "${criterion}"`, {debug: true});
  const data = {
    system: buildSystemPrompt(),
    email: body,
    query: criterion,
  };
  let template = gTemplateText || loadTemplate(gTemplateName);
  return template.replace(/{{\s*(\w+)\s*}}/g, (m, key) => data[key] || "");
}

class ClassificationTerm extends CustomerTermBase {
  constructor() {
    super("classification", [Ci.nsMsgSearchOp.Matches, Ci.nsMsgSearchOp.DoesntMatch]);
    aiLog(`[ExpressionSearchFilter] ClassificationTerm constructed`, {debug: true});
  }

  needsBody() { return true; }

  match(msgHdr, value, op) {
    const opName = op === Ci.nsMsgSearchOp.Matches ? "matches" :
                   op === Ci.nsMsgSearchOp.DoesntMatch ? "doesn't match" : `unknown (${op})`;
    aiLog(`[ExpressionSearchFilter] Matching message ${msgHdr.messageId} using op "${opName}" and value "${value}"`, {debug: true});

    let key = [msgHdr.messageId, op, value].map(sha256Hex).join("|");
    if (this.cache.has(key)) {
      aiLog(`[ExpressionSearchFilter] Cache hit for key: ${key}`, {debug: true});
      return this.cache.get(key);
    }

    let body = getPlainText(msgHdr);
    let payloadObj = Object.assign({
      prompt: buildPrompt(body, value)
    }, gAiParams);
    let payload = JSON.stringify(payloadObj);


    aiLog(`[ExpressionSearchFilter] Sending classification request to ${gEndpoint}`, {debug: true});

    let matched = false;
    try {
      let xhr = new XMLHttpRequest();
      xhr.open("POST", gEndpoint, false); // synchronous request
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(payload);

      if (xhr.status < 200 || xhr.status >= 300) {
        aiLog(`HTTP status ${xhr.status}`, {level: 'warn'});
      } else {
        const result = JSON.parse(xhr.responseText);
        aiLog(`[ExpressionSearchFilter] Received response:`, {debug: true}, result);
        const rawText = result.choices?.[0]?.text || "";
        const thinkText = rawText.match(/<think>[\s\S]*?<\/think>/gi)?.join('') || '';
        aiLog('[ExpressionSearchFilter] ⮡ Reasoning:', {debug: true}, thinkText);
        const cleanedText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        aiLog('[ExpressionSearchFilter] ⮡ Cleaned Response Text:', {debug: true}, cleanedText);
        const obj = JSON.parse(cleanedText);
        matched = obj.matched === true || obj.match === true;

        aiLog(`[ExpressionSearchFilter] Caching entry '${key}' → ${matched}`, {debug: true});
        this.cache.set(key, matched);
        this._saveCache(key, matched);
      }
    } catch (e) {
      aiLog(`HTTP request failed`, {level: 'error'}, e);
    }

    if (op === Ci.nsMsgSearchOp.DoesntMatch) {
      matched = !matched;
      aiLog(`[ExpressionSearchFilter] Operator is "doesn't match" → inverting to ${matched}`, {debug: true});
    }

    aiLog(`[ExpressionSearchFilter] Final match result: ${matched}`, {debug: true});
    return matched;
  }
}

(function register() {
  aiLog(`[ExpressionSearchFilter] Registering custom filter term...`, {debug: true});
  let term = new ClassificationTerm();
  if (!MailServices.filters.getCustomTerm(term.id)) {
    MailServices.filters.addCustomTerm(term);
    aiLog(`[ExpressionSearchFilter] Registered term: ${term.id}`, {debug: true});
  } else {
    aiLog(`[ExpressionSearchFilter] Term already registered: ${term.id}`, {debug: true});
  }
})();

var AIFilter = { setConfig };
