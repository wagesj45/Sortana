(function() {
  function patch(container) {
    if (!container || container.getAttribute("ai-filter-patched") === "true") {
      return;
    }
    while (container.firstChild) {
      container.firstChild.remove();
    }
    let frag = window.MozXULElement.parseXULToFragment(
      `<html:input class="search-value-textbox flexinput ai-filter-textbox" inherits="disabled"
        onchange="this.parentNode.setAttribute('value', this.value); this.parentNode.value=this.value;">
      </html:input>`
    );
    container.appendChild(frag);
    if (container.hasAttribute("value")) {
      container.firstChild.value = container.getAttribute("value");
    }
    container.classList.add("flexelementcontainer");
    container.setAttribute("ai-filter-patched", "true");
  }

  function check(node) {
    if (!(node instanceof Element)) {
      return;
    }
    if (
      node.classList.contains("search-value-custom") &&
      node.getAttribute("searchAttribute") === "aifilter#classification"
    ) {
      patch(node);
    }
    node
      .querySelectorAll('.search-value-custom[searchAttribute="aifilter#classification"]')
      .forEach(patch);
  }

  const observer = new MutationObserver(mutations => {
    for (let mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach(check);
      } else if (mutation.type === "attributes") {
        check(mutation.target);
      }
    }
  });

  const termList = document.getElementById("searchTermList") || document;
  observer.observe(termList, { childList: true, attributes: true, subtree: true });
  check(termList);
})();
