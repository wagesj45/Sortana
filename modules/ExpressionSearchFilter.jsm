"use strict";
var { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
var { MailServices }    = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
var { Services }        = globalThis || ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs");
var { NetUtil }         = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
var { MimeParser }      = ChromeUtils.importESModule("resource:///modules/mimeParser.sys.mjs");
var { aiLog } = ChromeUtils.import("resource://aifilter/modules/logger.jsm");
var { AiClassifier }    = ChromeUtils.import("resource://aifilter/modules/AiClassifier.jsm");

function sha256Hex(str) {
  const hasher = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
  hasher.init(Ci.nsICryptoHash.SHA256);
  const data = new TextEncoder().encode(str);
  hasher.update(data, data.length);
  const binary = hasher.finish(false);
  return Array.from(binary, c => ("0" + c.charCodeAt(0).toString(16)).slice(-2)).join("");
}

var EXPORTED_SYMBOLS = ["AIFilter", "ClassificationTerm"];

class CustomerTermBase {
  constructor(nameId, operators) {
    // Lookup our extension instance using the ID from manifest.json
    // so locale strings are resolved correctly.
    this.extension = ExtensionParent.GlobalManager.getExtension("ai-filter@jordanwages");
    this.id = "aifilter#" + nameId;
    this.name = this.extension.localeData.localizeMessage(nameId);
    this.operators = operators;

    aiLog(`[ExpressionSearchFilter] Initialized term base "${this.id}"`, {debug: true});
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

  try {
    let root = MimeParser.parseSync(data, {strformat: "unicode"});
    let parts = [];

    function pushPlaceholder(type, info, bytes) {
      bytes = bytes || 0;
      let prettyType = type.split("/")[1] || type;
      parts.push(`[${info}: ${prettyType}, ${bytes} bytes]`);
    }

    function byteSizeFromBase64(str) {
      let clean = str.replace(/[^A-Za-z0-9+/=]/g, "");
      return Math.floor(clean.length * 3 / 4);
    }

    function replaceInlineBase64(text) {
      return text.replace(/[A-Za-z0-9+/]{100,}={0,2}/g,
        m => `[base64: ${byteSizeFromBase64(m)} bytes]`);
    }

    function walk(node) {
      if (node.parts && node.parts.length) {
        for (let child of node.parts) {
          walk(child);
        }
        return;
      }

      let ct = (node.contentType || "text/plain").toLowerCase();
      let cd = (node.headers?.["content-disposition"]?.[0] || "").toLowerCase();
      let enc = (node.headers?.["content-transfer-encoding"]?.[0] || "").toLowerCase();
      let bodyText = String(node.body || "");

      if (cd.includes("attachment")) {
        pushPlaceholder(ct, "binary attachment", byteSizeFromBase64(bodyText));
      } else if (ct.startsWith("text/plain")) {
        if (enc === "base64") {
          parts.push(`[base64: ${byteSizeFromBase64(bodyText)} bytes]`);
        } else {
          parts.push(replaceInlineBase64(bodyText));
        }
      } else if (ct.startsWith("text/html")) {
        if (enc === "base64") {
          parts.push(`[base64: ${byteSizeFromBase64(bodyText)} bytes]`);
        } else {
          let txt = parser.convertToPlainText(bodyText,
            Ci.nsIDocumentEncoder.OutputLFLineBreak |
            Ci.nsIDocumentEncoder.OutputNoScriptContent |
            Ci.nsIDocumentEncoder.OutputNoFramesContent |
            Ci.nsIDocumentEncoder.OutputBodyOnly, 0);
          parts.push(replaceInlineBase64(txt));
        }
      } else {
        // Other single part types treated as attachments
        pushPlaceholder(ct, "binary attachment", byteSizeFromBase64(bodyText));
      }
    }

    walk(root);
    return parts.join("\n");
  } catch (e) {
    // Fallback: convert entire raw message to text
    aiLog(`Failed to parse MIME, falling back to raw conversion`, {level: 'warn'}, e);
    return parser.convertToPlainText(data,
      Ci.nsIDocumentEncoder.OutputLFLineBreak |
      Ci.nsIDocumentEncoder.OutputNoScriptContent |
      Ci.nsIDocumentEncoder.OutputNoFramesContent |
      Ci.nsIDocumentEncoder.OutputBodyOnly, 0);
  }
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
    let body = getPlainText(msgHdr);

    let matched = AiClassifier.classifyTextSync(body, value, key);

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

var AIFilter = { setConfig: AiClassifier.setConfig };
