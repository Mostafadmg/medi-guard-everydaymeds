(function () {
  if (window.__mgScrCapture) return;
  window.__mgScrCapture = true;

  let last = "";
  let sent = false;

  function grab(focus) {
    if (sent && focus !== true) return;
    if (!/\/app\/patient\b/.test(location.pathname)) return;
    const print = document.querySelector(".scr-print-wrapper, .clinicals-page");
    const heading = [...document.querySelectorAll("h1, h2, h3")].find((el) =>
      /General Practice Summary/i.test(el.textContent || "")
    );
    let root = print;
    if (!root && heading) {
      root = heading.parentElement;
      let node = heading.parentElement;
      while (node && node !== document.body) {
        const sample = node.innerText || "";
        if (/Find patient/i.test(sample) && /Change role/i.test(sample)) break;
        root = node;
        node = node.parentElement;
      }
    }
    if (!root) return;
    const text = (root.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length < 80 || text === last) return;
    last = text;
    sent = true;
    chrome.runtime.sendMessage({
      type: "SCR_HTML_READY",
      html: `<div class="scr-print-wrapper">${root.innerHTML}</div>`,
      focus: true
    }).catch(() => {});
  }

  const timer = setInterval(() => {
    grab(true);
    if (sent) clearInterval(timer);
  }, 1000);
  grab(true);
})();
