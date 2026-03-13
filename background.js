/* MediaFlow background.js */
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === "download") {
    var opts = { url: message.url, conflictAction: "uniquify" };
    if (message.filename && message.filename !== "unknown") {
      opts.filename = "MediaFlow/" + message.filename;
    }
    console.log("[MediaFlow] Downloading:", message.url);
    chrome.downloads.download(opts, function (downloadId) {
      if (chrome.runtime.lastError) {
        console.warn("Download error:", chrome.runtime.lastError.message);
      }
    });
  }
});
