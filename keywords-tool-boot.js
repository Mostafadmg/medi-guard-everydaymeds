(function () {
  function deliver(payload) {
    if (!payload?.content) return;
    let tries = 0;
    const tick = () => {
      chrome.runtime.sendMessage(
        {
          action: "renderSCRContent",
          content: payload.content,
          userData: payload.userData || {}
        },
        (resp) => {
          if (chrome.runtime.lastError || !resp?.success) {
            if (tries < 40) {
              tries += 1;
              setTimeout(tick, 250);
            }
          }
        }
      );
    };
    tick();
  }

  chrome.storage.session.get(["scrPendingHtml", "scrPendingPatient"], (data) => {
    if (!data?.scrPendingHtml) return;
    deliver({ content: data.scrPendingHtml, userData: data.scrPendingPatient || {} });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action === "renderSCRContent" && msg.content) {
      chrome.storage.session.set({
        scrPendingHtml: msg.content,
        scrPendingPatient: msg.userData || {}
      });
    }
  });
})();
