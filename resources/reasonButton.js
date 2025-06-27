(function() {
  function addButton() {
    const toolbar = document.querySelector("#header-view-toolbar") ||
                    document.querySelector("#mail-toolbox toolbar");
    if (!toolbar || document.getElementById('sortana-reason-button')) return;
    const button = document.createXULElement ?
          document.createXULElement('toolbarbutton') :
          document.createElement('button');
    button.id = 'sortana-reason-button';
    button.setAttribute('label', 'Show Reasoning');
    button.className = 'toolbarbutton-1';
    const icon = browser.runtime.getURL('resources/img/brain.png');
    if (button.setAttribute) {
      button.setAttribute('image', icon);
    } else {
      button.style.backgroundImage = `url(${icon})`;
      button.style.backgroundSize = 'contain';
    }
    button.addEventListener('command', async () => {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      const msgs = tabId ? await browser.messageDisplay.getDisplayedMessages(tabId) : [];
      if (!msgs.length) return;
      const url = browser.runtime.getURL(`reasoning.html?mid=${msgs[0].id}`);
      browser.tabs.create({ url });
    });
    toolbar.appendChild(button);
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    addButton();
  } else {
    document.addEventListener('DOMContentLoaded', addButton, { once: true });
  }
})();
