(function() {
  function addButton() {
    const toolbar = document.querySelector("#header-view-toolbar") ||
                    document.querySelector("#mail-toolbox toolbar");
    if (!toolbar || document.getElementById('sortana-clear-cache-button')) return;
    const button = document.createXULElement ?
          document.createXULElement('toolbarbutton') :
          document.createElement('button');
    button.id = 'sortana-clear-cache-button';
    button.setAttribute('label', 'Clear Cache');
    button.className = 'toolbarbutton-1';
    button.addEventListener('command', () => {
      browser.runtime.sendMessage({ type: 'sortana:clearCacheForDisplayed' });
    });
    toolbar.appendChild(button);
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    addButton();
  } else {
    document.addEventListener('DOMContentLoaded', addButton, { once: true });
  }
})();
