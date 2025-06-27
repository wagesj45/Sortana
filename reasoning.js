document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  const id = parseInt(params.get('mid'), 10);
  if (!id) return;
  try {
    const { subject, reasons } = await browser.runtime.sendMessage({ type: 'sortana:getReasons', id });
    document.getElementById('subject').textContent = subject;
    const container = document.getElementById('rules');
    for (const r of reasons) {
      const article = document.createElement('article');
      article.className = 'message mb-4';
      const header = document.createElement('div');
      header.className = 'message-header';
      header.innerHTML = `<p>${r.criterion}</p>`;
      const body = document.createElement('div');
      body.className = 'message-body';
      const pre = document.createElement('pre');
      pre.textContent = r.reason;
      body.appendChild(pre);
      article.appendChild(header);
      article.appendChild(body);
      container.appendChild(article);
    }
  } catch (e) {
    console.error('failed to load reasons', e);
  }
});
