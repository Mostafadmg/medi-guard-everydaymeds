// MediGuard — floating "return to prescription" control on NHS SCR patient page

(function () {
  if (document.getElementById("mg-scr-close-btn")) return;

  const style = document.createElement("style");
  style.textContent = `
    #mg-scr-close-btn {
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 2147483647;
      width: 44px;
      height: 44px;
      border: none;
      border-radius: 50%;
      background: #dc2626;
      color: #fff;
      font-size: 28px;
      line-height: 1;
      font-weight: 400;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(220, 38, 38, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
    }
    #mg-scr-close-btn:hover:not(:disabled) {
      background: #b91c1c;
      transform: scale(1.06);
      box-shadow: 0 6px 18px rgba(220, 38, 38, 0.5);
    }
    #mg-scr-close-btn:active:not(:disabled) { transform: scale(0.96); }
    #mg-scr-close-btn:disabled {
      opacity: 0.65;
      cursor: wait;
    }
    #mg-scr-close-btn:focus-visible {
      outline: 3px solid #fca5a5;
      outline-offset: 2px;
    }
  `;
  document.documentElement.appendChild(style);

  const btn = document.createElement("button");
  btn.id = "mg-scr-close-btn";
  btn.type = "button";
  btn.title = "Close SCR tabs and return to prescription";
  btn.setAttribute("aria-label", "Close SCR tabs and return to prescription");
  btn.textContent = "×";

  btn.addEventListener("click", () => {
    btn.disabled = true;
    try {
      chrome.runtime.sendMessage({ type: "SCR_CLOSE_AND_RETURN" }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  });

  const mount = () => {
    if (!document.body || document.getElementById("mg-scr-close-btn")) return;
    document.body.appendChild(btn);
    try {
      chrome.runtime.sendMessage({ type: "SCR_PATIENT_PAGE_OPENED" }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  };

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });

  new MutationObserver(() => {
    if (!document.getElementById("mg-scr-close-btn") && document.body) mount();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();