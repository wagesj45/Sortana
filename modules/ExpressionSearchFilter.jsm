"use strict";
var { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
var { MailServices }    = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
var { aiLog } = ChromeUtils.import("resource://aifilter/modules/logger.jsm");
var AiClassifier    = ChromeUtils.importESModule("resource://aifilter/modules/AiClassifier.js");
var { getPlainText }    = ChromeUtils.import("resource://aifilter/modules/messageUtils.jsm");

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
