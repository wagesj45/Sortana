document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  let id = parseInt(params.get('mid'), 10);

  if (!id) {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      const msgs = tabId ? await browser.messageDisplay.getDisplayedMessages(tabId) : [];
      id = msgs[0]?.id;
      if (!id) {
        const mailTabs = await browser.mailTabs.query({ active: true, currentWindow: true });
        const mailTabId = mailTabs[0]?.id;
        const selected = mailTabId !== undefined ? await browser.mailTabs.getSelectedMessages(mailTabId) : null;
        id = selected?.messages?.[0]?.id;
      }
    } catch (e) {
      console.error('failed to determine message id', e);
    }
  }
  if (!id) return;
  try {
    const { subject, results } = await browser.runtime.sendMessage({ type: 'sortana:getDetails', id });
    document.getElementById('subject').textContent = subject;
    const container = document.getElementById('rules');
    for (const r of results) {
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
      await browser.runtime.sendMessage({ type: 'sortana:clearCacheForMessage', id });
      window.close();
    });
  } catch (e) {
    console.error('failed to load details', e);
  }
});
