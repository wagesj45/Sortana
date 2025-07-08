const aiLog = (await import(browser.runtime.getURL("logger.js"))).aiLog;
const storage = (globalThis.messenger ?? browser).storage;
const { theme } = await storage.local.get('theme');
const mode = (theme || 'auto') === 'auto'
  ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  : theme;
document.documentElement.dataset.theme = mode;

const qMid = parseInt(new URLSearchParams(location.search).get("mid"), 10);
if (!isNaN(qMid)) {
  loadMessage(qMid);
} else {
  const { ids } = await browser.runtime.sendMessage({
    type: "sortana:getDisplayedMessages",
  });
  if (ids && ids[0]) {
    loadMessage(ids[0]);
  } else {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      const msgs = tabId ? await browser.messageDisplay.getDisplayedMessages(tabId) : [];
      let id = msgs[0]?.id;
      if (id) {
          loadMessage(id);
      }
      else {
          aiLog("Details popup: no displayed message found");
      }
  }
}

async function loadMessage(id) {
  const storage = (globalThis.messenger ?? browser).storage;
  const logMod = await import(browser.runtime.getURL('logger.js'));
  const { debugLogging } = await storage.local.get('debugLogging');
  logMod.setDebug(debugLogging === true);
  const log = logMod.aiLog;

  log('details page loaded', { debug: true });
  try {
    log('requesting message details', {}, id);
    const { subject, results } = await browser.runtime.sendMessage({ type: 'sortana:getDetails', id });
    log('received details', { debug: true }, { subject, results });
    document.getElementById('subject').textContent = subject;
    const container = document.getElementById('rules');
    for (const r of results) {
      log('rendering rule result', { debug: true }, r);
      const article = document.createElement('article');
      const color = r.matched === true ? 'is-success' : 'is-danger';
      article.className = `message ${color} mb-4`;
      const header = document.createElement('div');
      header.className = 'message-header';
      header.innerHTML = `<p>${r.criterion}</p>`;
      const body = document.createElement('div');
      body.className = 'message-body';
      const status = document.createElement('p');
      status.textContent = r.matched ? 'Matched' : 'Did not match';
      const pre = document.createElement('pre');
      pre.textContent = r.reason || '';
      body.appendChild(status);
      body.appendChild(pre);
      article.appendChild(header);
      article.appendChild(body);
      container.appendChild(article);
    }
    document.getElementById('clear').addEventListener('click', async () => {
      log('clearing cache for message', {}, id);
      await browser.runtime.sendMessage({ type: 'sortana:clearCacheForMessage', id });
      window.close();
    });
  } catch (e) {
    log('failed to load details', { level: 'error' }, e);
  }
}
