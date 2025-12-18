(() => {
  const AD_CONTAINER_SELECTOR = ".ad-container";
  const AD_SLOT_SELECTOR = "ins.adsbygoogle";

  function hideContainer(container, reason) {
    if (!container || container.dataset.adState === "hidden") return;
    container.dataset.adState = "hidden";
    container.dataset.adHiddenReason = reason;
    container.style.display = "none";
  }

  function markFilled(container) {
    if (!container || container.dataset.adState === "filled") return;
    container.dataset.adState = "filled";
  }

  function observeAdSlot(ins) {
    const container = ins.closest(AD_CONTAINER_SELECTOR);
    if (!container) return;

    if (!container.dataset.adState) container.dataset.adState = "loading";

    const updateState = () => {
      const status = ins.getAttribute("data-ad-status");
      if (status === "unfilled") {
        hideContainer(container, "unfilled");
        return;
      }
      if (status === "filled") {
        markFilled(container);
        return;
      }

      const hasIframe = Boolean(ins.querySelector("iframe"));
      if (hasIframe) markFilled(container);
    };

    updateState();

    const observer = new MutationObserver(() => {
      updateState();
      if (container.dataset.adState === "hidden") observer.disconnect();
    });

    observer.observe(ins, {
      attributes: true,
      attributeFilter: ["data-ad-status", "data-adsbygoogle-status"],
      childList: true,
      subtree: true,
    });

    window.setTimeout(() => {
      if (container.dataset.adState === "filled") return;
      if (container.dataset.adState === "hidden") return;

      const status = ins.getAttribute("data-ad-status");
      if (status === "unfilled") {
        hideContainer(container, "unfilled");
        return;
      }
      if (status === "filled") {
        markFilled(container);
        return;
      }

      const hasIframe = Boolean(ins.querySelector("iframe"));
      if (hasIframe) {
        markFilled(container);
        return;
      }

      hideContainer(container, "blocked_or_unavailable");
    }, 8000);
  }

  function init() {
    document.querySelectorAll(AD_SLOT_SELECTOR).forEach(observeAdSlot);
  }

  if (document.readyState === "complete") init();
  else window.addEventListener("load", init, { once: true });
})();

