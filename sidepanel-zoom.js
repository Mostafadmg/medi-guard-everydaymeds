(function () {
  try {
    var apply = function (z) {
      var n = parseInt(z, 10);
      if (!isFinite(n)) n = 100;
      if (n < 80) n = 80;
      if (n > 200) n = 200;
      document.documentElement.style.zoom = n / 100;
    };
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(["ui_zoom"], function (r) { apply(r && r.ui_zoom); });
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === "sync" && changes.ui_zoom) apply(changes.ui_zoom.newValue);
      });
    }
  } catch (e) {}
})();
