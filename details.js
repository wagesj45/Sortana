document.addEventListener('DOMContentLoaded', async () => {
  const storage = (globalThis.messenger ?? browser).storage;
  const logger = await import(browser.runtime.getURL('logger.js'));
  const { debugLogging } = await storage.local.get('debugLogging');
  logger.setDebug(debugLogging === true);
  logger.aiLog('details page loaded', { debug: true });

  const params = new URLSearchParams(location.search);
  let id = parseInt(params.get('mid'), 10);
  logger.aiLog('initial message id', { debug: true }, id);

  if (!id) {
    try {
      const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      const tabId = tabs[0]?.id;
      const msgs = tabId ? await browser.messageDisplay.getDisplayedMessages(tabId) : [];
      id = msgs[0]?.id;
      logger.aiLog('message id from displayed messages', { debug: true }, id);
      if (!id) {
        const mailTabs = await browser.mailTabs.query({ active: true, lastFocusedWindow: true });
        const mailTabId = mailTabs[0]?.id;
        const selected = mailTabId !== undefined ? await browser.mailTabs.getSelectedMessages(mailTabId) : null;
        id = selected?.messages?.[0]?.id;
        logger.aiLog('message id from selected messages', { debug: true }, id);
      }
    } catch (e) {
      logger.aiLog('failed to determine message id', { level: 'error' }, e);
    }
  }
  if (!id) return;
  try {
    logger.aiLog('requesting message details', {}, id);
    const { subject, results } = await browser.runtime.sendMessage({ type: 'sortana:getDetails', id });
    logger.aiLog('received details', { debug: true }, { subject, results });
    document.getElementById('subject').textContent = subject;
    const container = document.getElementById('rules');
    for (const r of results) {
      logger.aiLog('rendering rule result', { debug: true }, r);
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
      logger.aiLog('clearing cache for message', {}, id);
      await browser.runtime.sendMessage({ type: 'sortana:clearCacheForMessage', id });
      window.close();
    });
  } catch (e) {
    logger.aiLog('failed to load details', { level: 'error' }, e);
  }
});
