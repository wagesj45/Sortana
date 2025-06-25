"use strict";
import { aiLog, setDebug } from "../logger.js";
const { Services } = globalThis || ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs");

const SYSTEM_PREFIX = `You are an email-classification assistant.
Read the email below and the classification criterion provided by the user.
`;

const DEFAULT_CUSTOM_SYSTEM_PROMPT = "Determine whether the email satisfies the user's criterion.";

const SYSTEM_SUFFIX = `
Return ONLY a JSON object on a single line of the form:
{"match": true} - if the email satisfies the criterion
{"match": false} - otherwise

Do not add any other keys, text, or formatting.`;

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

let gCache = new Map();
let gCacheLoaded = false;

async function loadCache() {
  if (gCacheLoaded) {
    return;
  }
  aiLog(`[AiClassifier] Loading cache`, {debug: true});
  try {
    const { aiCache } = await browser.storage.local.get("aiCache");
    if (aiCache) {
      for (let [k, v] of Object.entries(aiCache)) {
        aiLog(`[AiClassifier] ⮡ Loaded entry '${k}' → ${v}`, {debug: true});
        gCache.set(k, v);
      }
      aiLog(`[AiClassifier] Loaded ${gCache.size} cache entries`, {debug: true});
    } else {
      aiLog(`[AiClassifier] Cache is empty`, {debug: true});
    }
  } catch (e) {
    aiLog(`Failed to load cache`, {level: 'error'}, e);
  }
  gCacheLoaded = true;
}

function loadCacheSync() {
  if (!gCacheLoaded) {
    let done = false;
    loadCache().finally(() => { done = true; });
    Services.tm.spinEventLoopUntil(() => done);
  }
}

async function saveCache(updatedKey, updatedValue) {
  if (typeof updatedKey !== "undefined") {
    aiLog(`[AiClassifier] ⮡ Persisting entry '${updatedKey}' → ${updatedValue}`, {debug: true});
  }
  try {
    await browser.storage.local.set({ aiCache: Object.fromEntries(gCache) });
  } catch (e) {
    aiLog(`Failed to save cache`, {level: 'error'}, e);
  }
}

async function loadTemplate(name) {
  try {
    const url = typeof browser !== "undefined" && browser.runtime?.getURL
      ? browser.runtime.getURL(`prompt_templates/${name}.txt`)
      : `resource://aifilter/prompt_templates/${name}.txt`;
    const res = await fetch(url);
    if (res.ok) {
      return await res.text();
    }
  } catch (e) {
    aiLog(`Failed to load template '${name}':`, {level: 'error'}, e);
  }
  return "";
}

function loadTemplateSync(name) {
  let text = "";
  let done = false;
  loadTemplate(name).then(t => { text = t; }).catch(() => {}).finally(() => { done = true; });
  Services.tm.spinEventLoopUntil(() => done);
  return text;
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
  gTemplateText = gTemplateName === "custom" ? gCustomTemplate : loadTemplateSync(gTemplateName);
  aiLog(`[AiClassifier] Endpoint set to ${gEndpoint}`, {debug: true});
  aiLog(`[AiClassifier] Template set to ${gTemplateName}`, {debug: true});
}

function buildSystemPrompt() {
  return SYSTEM_PREFIX + (gCustomSystemPrompt || DEFAULT_CUSTOM_SYSTEM_PROMPT) + SYSTEM_SUFFIX;
}

function buildPrompt(body, criterion) {
  aiLog(`[AiClassifier] Building prompt with criterion: "${criterion}"`, {debug: true});
  const data = {
    system: buildSystemPrompt(),
    email: body,
    query: criterion,
  };
  let template = gTemplateText || loadTemplateSync(gTemplateName);
  return template.replace(/{{\s*(\w+)\s*}}/g, (m, key) => data[key] || "");
}

function getCachedResult(cacheKey) {
  loadCacheSync();
  if (cacheKey && gCache.has(cacheKey)) {
    aiLog(`[AiClassifier] Cache hit for key: ${cacheKey}`, {debug: true});
    return gCache.get(cacheKey);
  }
  return null;
}

function buildPayload(text, criterion) {
  let payloadObj = Object.assign({
    prompt: buildPrompt(text, criterion)
  }, gAiParams);
  return JSON.stringify(payloadObj);
}

function parseMatch(result) {
  const rawText = result.choices?.[0]?.text || "";
  const thinkText = rawText.match(/<think>[\s\S]*?<\/think>/gi)?.join('') || '';
  aiLog('[AiClassifier] ⮡ Reasoning:', {debug: true}, thinkText);
  const cleanedText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  aiLog('[AiClassifier] ⮡ Cleaned Response Text:', {debug: true}, cleanedText);
  const obj = JSON.parse(cleanedText);
  return obj.matched === true || obj.match === true;
}

function cacheResult(cacheKey, matched) {
  if (cacheKey) {
    aiLog(`[AiClassifier] Caching entry '${cacheKey}' → ${matched}`, {debug: true});
    gCache.set(cacheKey, matched);
    saveCache(cacheKey, matched);
  }
}

function classifyTextSync(text, criterion, cacheKey = null) {
  const cached = getCachedResult(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const payload = buildPayload(text, criterion);

  aiLog(`[AiClassifier] Sending classification request to ${gEndpoint}`, {debug: true});

  let result;
  let done = false;
  (async () => {
    try {
      const response = await fetch(gEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (response.ok) {
        const json = await response.json();
        aiLog(`[AiClassifier] Received response:`, {debug: true}, json);
        result = parseMatch(json);
        cacheResult(cacheKey, result);
      } else {
        aiLog(`HTTP status ${response.status}`, {level: 'warn'});
        result = false;
      }
    } catch (e) {
      aiLog(`HTTP request failed`, {level: 'error'}, e);
      result = false;
    } finally {
      done = true;
    }
  })();
  Services.tm.spinEventLoopUntil(() => done);
  return result;
}

async function classifyText(text, criterion, cacheKey = null) {
  const cached = getCachedResult(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const payload = buildPayload(text, criterion);

  aiLog(`[AiClassifier] Sending classification request to ${gEndpoint}`, {debug: true});

  try {
    const response = await fetch(gEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });

    if (!response.ok) {
      aiLog(`HTTP status ${response.status}`, {level: 'warn'});
      return false;
    }

    const result = await response.json();
    aiLog(`[AiClassifier] Received response:`, {debug: true}, result);
    const matched = parseMatch(result);
    cacheResult(cacheKey, matched);
    return matched;
  } catch (e) {
    aiLog(`HTTP request failed`, {level: 'error'}, e);
    return false;
  }
}

export { classifyText, classifyTextSync, setConfig };
