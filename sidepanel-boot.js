(function () {
  try {
    var listeners = [];
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};
    if (!window.chrome.runtime.onMessage) {
      window.chrome.runtime.onMessage = {
        addListener: function (fn) { if (typeof fn === "function") listeners.push(fn); },
        removeListener: function (fn) {
          var i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
        hasListener: function (fn) { return listeners.indexOf(fn) >= 0; }
      };
    }
    if (!window.chrome.runtime.sendMessage) {
      window.chrome.runtime.sendMessage = function () { return Promise.resolve(); };
    }
    if (!window.chrome.runtime.getURL) {
      window.chrome.runtime.getURL = function (path) { return path; };
    }
    if (!window.chrome.runtime.openOptionsPage) {
      window.chrome.runtime.openOptionsPage = function () {
        try { window.open("/extension2/options.html", "_blank"); } catch (e) {}
      };
    }
    if (!window.chrome.storage) window.chrome.storage = {};
    if (!window.chrome.storage.sync) {
      window.chrome.storage.sync = {
        get: function (keys, cb) {
          try {
            var out = {};
            if (keys && typeof keys === "object" && !Array.isArray(keys)) out = Object.assign({}, keys);
            if (cb) cb(out);
          } catch (e) {
            try { if (cb) cb({}); } catch (_) {}
          }
        },
        set: function (_obj, cb) { try { if (cb) cb(); } catch (e) {} }
      };
    }
    window.addEventListener("message", function (ev) {
      try {
        if (ev.origin !== window.location.origin) return;
        if (window.parent && ev.source !== window.parent) return;
        var data = ev.data;
        if (!data || data.__mg_to !== "panel" || !data.__mg_event || !data.message) return;
        for (var i = 0; i < listeners.length; i++) {
          try { listeners[i](data.message, { id: "mediguard-pwa-page" }, function () {}); } catch (e) {}
        }
      } catch (e) {}
    });
  } catch (e) {}
})();
