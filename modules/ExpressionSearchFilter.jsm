"use strict";
var { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
var { MailServices }    = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
var { Services }        = globalThis || ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs");
var { NetUtil }         = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
var { MimeParser }      = ChromeUtils.importESModule("resource:///modules/mimeParser.sys.mjs");

var EXPORTED_SYMBOLS = ["AIFilter", "ClassificationTerm"];

class CustomerTermBase {
  constructor(nameId, operators) {
    this.extension = ExtensionParent.GlobalManager.getExtension("ai-filter@example");
    this.id = "aifilter#" + nameId;
    this.name = this.extension.localeData.localizeMessage(nameId);
    this.operators = operators;
    this.cache = new Map();

    console.log(`[ai-filter][ExpressionSearchFilter] Initialized term base "${this.id}"`);
  }

  getEnabled() {
    console.log(`[ai-filter][ExpressionSearchFilter] getEnabled() called on "${this.id}"`);
    return true;
  }

  getAvailable() {
    console.log(`[ai-filter][ExpressionSearchFilter] getAvailable() called on "${this.id}"`);
    return true;
  }

  getAvailableOperators() {
    console.log(`[ai-filter][ExpressionSearchFilter] getAvailableOperators() called on "${this.id}"`);
    return this.operators;
  }

  getAvailableValues() {
    console.log(`[ai-filter][ExpressionSearchFilter] getAvailableValues() called on "${this.id}"`);
    return null;
  }

  get attrib() {
    console.log(`[ai-filter][ExpressionSearchFilter] attrib getter called for "${this.id}"`);

    //return Ci.nsMsgSearchAttrib.Custom;
  }
}

function getPlainText(msgHdr) {
  console.log(`[ai-filter][ExpressionSearchFilter] Extracting plain text for message ID ${msgHdr.messageId}`);
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
function setConfig(config = {}) {
    if (config.endpoint) {
        gEndpoint = config.endpoint;
    }
    console.log(`[ai-filter][ExpressionSearchFilter] Endpoint set to ${gEndpoint}`);
}

function buildPrompt(body, criterion) {
  console.log(`[ai-filter][ExpressionSearchFilter] Building prompt with criterion: "${criterion}"`);
  return `<|im_start|>system
You are an email-classification assistant.
Read the email below and the classification criterion provided by the user.

Return ONLY a JSON object on a single line of the form:
{"match": true} - if the email satisfies the criterion
{"match": false} - otherwise

Do not add any other keys, text, or formatting.<|im_end|>
<|im_start|>user
**Email Contents**
\`\`\`
${body}
\`\`\`
Classification Criteria: ${criterion}<|im_end|>
<|im_start|>assistant`;
}

class ClassificationTerm extends CustomerTermBase {
  constructor() {
    super("classification", [Ci.nsMsgSearchOp.Matches, Ci.nsMsgSearchOp.DoesntMatch]);
    console.log(`[ai-filter][ExpressionSearchFilter] ClassificationTerm constructed`);
  }

  needsBody() { return true; }

  match(msgHdr, value, op) {
    const opName = op === Ci.nsMsgSearchOp.Matches ? "matches" :
                   op === Ci.nsMsgSearchOp.DoesntMatch ? "doesn't match" : `unknown (${op})`;
    console.log(`[ai-filter][ExpressionSearchFilter] Matching message ${msgHdr.messageId} using op "${opName}" and value "${value}"`);

    let key = msgHdr.messageId + "|" + op + "|" + value;
    if (this.cache.has(key)) {
      console.log(`[ai-filter][ExpressionSearchFilter] Cache hit for key: ${key}`);
      return this.cache.get(key);
    }

    let body = getPlainText(msgHdr);
    let payload = JSON.stringify({
      prompt: buildPrompt(body, value),
      max_tokens: 4096,
      temperature: 1.31,
      top_p: 1,
      seed: -1,
      repetition_penalty: 1.0,
      top_k: 0,
      min_p: 0.2,
      presence_penalty: 0,
      frequency_penalty: 0,
      typical_p: 1,
      tfs: 1
    });


    console.log(`[ai-filter][ExpressionSearchFilter] Sending classification request to ${gEndpoint}`);

    let matched = false;
    try {
      let xhr = new XMLHttpRequest();
      xhr.open("POST", gEndpoint, false); // synchronous request
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(payload);

      if (xhr.status < 200 || xhr.status >= 300) {
        console.warn(`[ai-filter][ExpressionSearchFilter] HTTP status ${xhr.status}`);
      } else {
        const result = JSON.parse(xhr.responseText);
        const rawText = result.choices?.[0]?.text || "";
        const cleanedText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        const obj = JSON.parse(cleanedText);
        matched = obj.matched === true || obj.match === true;
        console.log(`[ai-filter][ExpressionSearchFilter] Received response:`, result);

        console.log(`[ai-filter][ExpressionSearchFilter] Caching:`, key);
        this.cache.set(key, matched);
      }
    } catch (e) {
      console.error(`[ai-filter][ExpressionSearchFilter] HTTP request failed:`, e);
    }

    if (op === Ci.nsMsgSearchOp.DoesntMatch) {
      matched = !matched;
      console.log(`[ai-filter][ExpressionSearchFilter] Operator is "doesn't match" → inverting to ${matched}`);
    }

    console.log(`[ai-filter][ExpressionSearchFilter] Final match result: ${matched}`);
    return matched;
  }
}

(function register() {
  console.log(`[ai-filter][ExpressionSearchFilter] Registering custom filter term...`);
  let term = new ClassificationTerm();
  if (!MailServices.filters.getCustomTerm(term.id)) {
    MailServices.filters.addCustomTerm(term);
    console.log(`[ai-filter][ExpressionSearchFilter] Registered term: ${term.id}`);
  } else {
    console.log(`[ai-filter][ExpressionSearchFilter] Term already registered: ${term.id}`);
  }
})();

var AIFilter = { setConfig };
