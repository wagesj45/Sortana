"use strict";
var { NetUtil }    = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
var { MimeParser } = ChromeUtils.importESModule("resource:///modules/mimeParser.sys.mjs");
var { aiLog }      = ChromeUtils.import("resource://aifilter/modules/logger.jsm");

var EXPORTED_SYMBOLS = ["getPlainText"];

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

