/* Media Downloader popup.js */
var allMedia = [];
var selectedUrls = new Set();
var currentTab = "all";
var currentView = "grid";
var currentSort = "largest";
var S = function (s) { return document.querySelector(s); };
var SA = function (s) { return document.querySelectorAll(s); };

document.addEventListener("DOMContentLoaded", async function () {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  SA(".stat-chip[data-tab]").forEach(function (t) { t.addEventListener("click", function () { switchTab(t.dataset.tab); }); });
  S("#selectAll").addEventListener("change", function (e) {
    var visible = getVisibleMedia();
    if (e.target.checked) { visible.forEach(function (m) { selectedUrls.add(m.url); }); }
    else { visible.forEach(function (m) { selectedUrls.delete(m.url); }); }
    renderGrid(); updateDlButton();
  });
  S("#dlSelected").addEventListener("click", downloadSelected);
  SA(".view-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      SA(".view-btn").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active"); currentView = btn.dataset.view; renderGrid();
    });
  });
  S("#sortBtn").addEventListener("click", function () {
    var svgL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h10"/><path d="M11 9h7"/><path d="M11 13h4"/><path d="m3 17 3 3 3-3"/><path d="M6 18V4"/></svg>Largest';
    var svgS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h4"/><path d="M11 9h7"/><path d="M11 13h10"/><path d="m3 7 3-3 3 3"/><path d="M6 6v14"/></svg>Smallest';
    if (currentSort === "largest") { currentSort = "smallest"; this.innerHTML = svgS; }
    else { currentSort = "largest"; this.innerHTML = svgL; }
    renderGrid();
  });
  scanPage();
});

async function scanPage() {
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var results = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: extractMedia, world: "MAIN" });
    var media = results && results[0] && results[0].result ? results[0].result : [];
    var seen = new Set();
    allMedia = media.filter(function (m) { if (seen.has(m.url)) return false; seen.add(m.url); return true; });
    updateStats(); switchTab("all");
    S("#statsBar").style.display = "flex";
    S("#scanningState").style.display = "none"; S("#resultsWrap").style.display = "block";
    S("#statsBar").classList.add("fade-in");
    var total = allMedia.length;
    S("#status").textContent = total > 0 ? "Found " + total + " media asset" + (total !== 1 ? "s" : "") + "." : "";
  } catch (err) {
    console.error("Scan error:", err);
    S("#scanningState").style.display = "none";
    S("#emptyState").style.display = "flex";
    S("#status").textContent = "Cannot scan this page.";
  }
}

async function extractMedia() {
  var media = [];
  var vidExts = ["mp4","mov","webm"];
  var audExts = ["mp3","wav","ogg","aac","m4a"];
  function getExt(url) { try { return new URL(url, location.href).pathname.split(".").pop().toLowerCase().split("?")[0]; } catch(e) { return ""; } }
  function getFilename(url) { try { return new URL(url, location.href).pathname.split("/").pop() || "unknown"; } catch(e) { return "unknown"; } }
  function resolveUrl(src) { try { return new URL(src, location.href).href; } catch(e) { return null; } }
  function stripResizeParams(url) {
    try {
      var u = new URL(url);
      var isShopify = u.hostname.indexOf("shopify.com") !== -1 || u.pathname.indexOf("/cdn/shop/") !== -1;

      if (isShopify) {
        // Shopify CDN: strip all resize params to get the original upload
        u.searchParams.delete("width");
        u.searchParams.delete("height");
        u.searchParams.delete("crop");
        // Shopify filename sizes: _312x or _312x468 or _grande/_large etc
        u.pathname = u.pathname.replace(/_\d+x\d*(\.\w+)$/, "$1");
        u.pathname = u.pathname.replace(/_(?:pico|icon|thumb|small|compact|medium|large|grande|original|master|\d+x\d+)(\.\w+)$/, "$1");
        return u.href;
      }

      // Generic CDN: maximize or strip resize query params
      if (u.searchParams.has("width")) u.searchParams.set("width", "5000");
      else if (u.searchParams.has("w")) u.searchParams.set("w", "5000");
      ["h", "height", "size", "resize", "fit", "crop",
       "dpr", "q", "quality", "auto", "format", "fm", "fl",
       "max-w", "max-h", "min-w", "min-h"].forEach(function (p) { u.searchParams.delete(p); });
      // WordPress: remove -312x468 from filename
      u.pathname = u.pathname.replace(/-\d+x\d+(\.\w+)$/, "$1");
      // Cloudinary: remove /w_312/ or /c_scale,w_312,h_468/ etc from path
      u.pathname = u.pathname.replace(/\/[cwh]_\d+[^/]*/g, "");
      u.pathname = u.pathname.replace(/\/c_[^/]+/g, "");
      // Next.js /_next/image proxy: extract original URL
      if (u.pathname === "/_next/image" && u.searchParams.has("url")) {
        var orig = u.searchParams.get("url");
        u.searchParams.delete("url");
        try { return new URL(orig, u.origin).href; } catch(e) { return orig; }
      }
      return u.href;
    } catch (e) { return url; }
  }

  function addMedia(url, type, extra) {
    var resolved = resolveUrl(url); if (!resolved) return;
    if (type === "images") resolved = stripResizeParams(resolved);
    var ext = getExt(resolved);
    var item = { url: resolved, type: type, ext: ext.toUpperCase(), filename: getFilename(resolved) };
    if (extra) { if (extra.width) item.width = extra.width; if (extra.height) item.height = extra.height; if (extra.svgData) item.svgData = extra.svgData; if (extra.inline) item.inline = extra.inline; if (extra.thumb) item.thumb = extra.thumb; }
    media.push(item);
  }

  function captureFromDom(img) {
    try {
      if (!img.naturalWidth || !img.naturalHeight) return null;
      var c = document.createElement("canvas");
      var size = 150;
      c.width = size; c.height = size;
      var ctx = c.getContext("2d");
      var scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
      var w = img.naturalWidth * scale;
      var h = img.naturalHeight * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      return c.toDataURL("image/jpeg", 0.5);
    } catch (e) { return null; }
  }

  function reloadWithCors(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      var done = false;
      img.onload = function () {
        if (done) return; done = true;
        try {
          var c = document.createElement("canvas");
          c.width = 150; c.height = 150;
          var ctx = c.getContext("2d");
          var scale = Math.max(150 / img.naturalWidth, 150 / img.naturalHeight);
          var w = img.naturalWidth * scale;
          var h = img.naturalHeight * scale;
          ctx.drawImage(img, (150 - w) / 2, (150 - h) / 2, w, h);
          resolve(c.toDataURL("image/jpeg", 0.5));
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { if (!done) { done = true; resolve(null); } };
      setTimeout(function () { if (!done) { done = true; resolve(null); } }, 2000);
      img.src = url;
    });
  }

  function parseSrcset(srcset) {
    if (!srcset) return [];
    return srcset.split(",").map(function (entry) {
      var parts = entry.trim().split(/\s+/);
      var url = parts[0];
      var descriptor = parts[1] || "";
      var width = 0;
      if (descriptor.endsWith("w")) width = parseInt(descriptor) || 0;
      else if (descriptor.endsWith("x")) width = (parseFloat(descriptor) || 1) * 1000;
      return { url: url, width: width };
    }).filter(function (e) { return e.url && !e.url.startsWith("data:"); });
  }

  function getBestSrc(img) {
    var candidates = [];
    // currentSrc is the URL the browser actually loaded (may be from srcset)
    var currentSrc = img.currentSrc;
    if (currentSrc && !currentSrc.startsWith("data:")) candidates.push({ url: currentSrc, width: img.naturalWidth || 0 });
    // src attribute is the fallback — give it score 0 so srcset wins
    var src = img.getAttribute("src");
    if (src && !src.startsWith("data:") && resolveUrl(src) !== resolveUrl(currentSrc)) candidates.push({ url: src, width: 0 });

    var srcset = img.getAttribute("srcset");
    parseSrcset(srcset).forEach(function (c) { candidates.push(c); });

    var parent = img.closest("picture");
    if (parent) {
      parent.querySelectorAll("source").forEach(function (source) {
        parseSrcset(source.getAttribute("srcset")).forEach(function (c) { candidates.push(c); });
      });
    }

    ["data-src", "data-original", "data-full", "data-full-src", "data-hi-res", "data-large-src", "data-original-src"].forEach(function (attr) {
      var val = img.getAttribute(attr);
      if (val && !val.startsWith("data:")) candidates.push({ url: val, width: 9999 });
    });

    if (candidates.length === 0) return null;
    candidates.sort(function (a, b) { return b.width - a.width; });
    return candidates[0].url;
  }

  var imgElements = document.querySelectorAll("img");
  var thumbMap = {};

  imgElements.forEach(function (img) {
    var bestSrc = getBestSrc(img);
    var displaySrc = img.currentSrc || img.src;
    if (!bestSrc && !displaySrc) return;
    if (!bestSrc) bestSrc = displaySrc;
    if (!displaySrc || displaySrc.startsWith("data:")) displaySrc = bestSrc;
    var thumb = captureFromDom(img);
    var resolved = resolveUrl(bestSrc);
    if (resolved) thumbMap[resolved] = { thumb: thumb, el: img };
    addMedia(bestSrc, getExt(bestSrc) === "svg" ? "svgs" : "images", { width: img.naturalWidth, height: img.naturalHeight, thumb: thumb });
  });

  var corsNeeded = [];
  for (var i = 0; i < media.length; i++) {
    if ((media[i].type === "images") && !media[i].thumb) {
      corsNeeded.push(i);
    }
  }

  if (corsNeeded.length > 0) {
    var batch = corsNeeded.slice(0, 30);
    var promises = batch.map(function (idx) {
      return reloadWithCors(media[idx].url).then(function (t) { if (t) media[idx].thumb = t; });
    });
    await Promise.all(promises);
  }

  /* picture sources already handled in getBestSrc above */
  document.querySelectorAll("video").forEach(function (vid) {
    if (vid.src) addMedia(vid.src, "videos", { width: vid.videoWidth, height: vid.videoHeight });
    vid.querySelectorAll("source").forEach(function (s) { if (s.src) addMedia(s.src, "videos"); });
    if (vid.poster) addMedia(vid.poster, "images");
  });
  document.querySelectorAll("audio").forEach(function (aud) {
    if (aud.src) addMedia(aud.src, "audio");
    aud.querySelectorAll("source").forEach(function (s) { if (s.src) addMedia(s.src, "audio"); });
  });
  document.querySelectorAll("svg").forEach(function (svg) {
    var rect = svg.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 16) return;
    if (svg.closest("[aria-hidden]") && rect.width < 32) return;
    var svgString = new XMLSerializer().serializeToString(svg);
    media.push({ url: URL.createObjectURL(new Blob([svgString], { type: "image/svg+xml" })), type: "svgs", ext: "SVG", filename: "inline-svg.svg", inline: true, svgData: svgString, width: Math.round(rect.width), height: Math.round(rect.height) });
  });
  document.querySelectorAll("*").forEach(function (el) {
    var bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== "none") { var m = bg.match(/url\(["']?(.*?)["']?\)/); if (m && m[1] && !m[1].startsWith("data:")) { var ext = getExt(m[1]); addMedia(m[1], ext === "svg" ? "svgs" : vidExts.indexOf(ext) !== -1 ? "videos" : audExts.indexOf(ext) !== -1 ? "audio" : "images"); } }
  });
  document.querySelectorAll('object[data$=".svg"], embed[src$=".svg"]').forEach(function (el) { var src = el.data || el.src; if (src) addMedia(src, "svgs"); });
  return media;
}

function getVisibleMedia() {
  var list = currentTab === "all" ? allMedia.slice() : allMedia.filter(function (m) { return m.type === currentTab; });
  list.sort(function (a, b) {
    var areaA = (a.width || 0) * (a.height || 0);
    var areaB = (b.width || 0) * (b.height || 0);
    return currentSort === "largest" ? areaB - areaA : areaA - areaB;
  });
  return list;
}

function updateStats() {
  var imgs = allMedia.filter(function (m) { return m.type === "images"; }).length;
  var vids = allMedia.filter(function (m) { return m.type === "videos"; }).length;
  var svgs = allMedia.filter(function (m) { return m.type === "svgs"; }).length;
  var auds = allMedia.filter(function (m) { return m.type === "audio"; }).length;
  S("#allCount").textContent = allMedia.length; S("#imgCount").textContent = imgs; S("#vidCount").textContent = vids;
  S("#svgCount").textContent = svgs; S("#audCount").textContent = auds;
}

function switchTab(tab) {
  currentTab = tab;
  SA(".stat-chip[data-tab]").forEach(function (t) { t.classList.toggle("active", t.dataset.tab === tab); });
  selectedUrls.clear(); S("#selectAll").checked = false;
  updateDlButton(); renderGrid();
}

function escHtml(str) { var div = document.createElement("div"); div.textContent = str; return div.innerHTML; }

function renderGrid() {
  var grid = S("#mediaGrid");
  var visible = getVisibleMedia();
  grid.className = "media-grid" + (currentView === "list" ? " list-view" : "");
  if (visible.length === 0) { S("#resultsWrap").style.display = "none"; S("#emptyState").style.display = "flex"; return; }
  S("#resultsWrap").style.display = "block"; S("#emptyState").style.display = "none";
  var html = "";
  for (var i = 0; i < visible.length; i++) {
    var m = visible[i];
    var isSelected = selectedUrls.has(m.url);
    var isImage = m.type === "images" || m.type === "svgs";
    var dims = m.width && m.height ? m.width + "\u00d7" + m.height : "";
    var delay = Math.min(i * 30, 300);
    var thumbSrc = m.thumb || m.url;
    var thumbHtml = isImage ? '<img class="thumb" src="' + escHtml(thumbSrc) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'" />' : m.type === "videos" ? '<div class="thumb-placeholder">\u25b6</div>' : '<div class="thumb-placeholder">\u266b</div>';
    html += '<div class="media-card fade-in' + (isSelected ? " selected" : "") + '" data-url="' + escHtml(m.url) + '" data-index="' + i + '" style="animation-delay:' + delay + 'ms" title="' + escHtml(m.filename) + '">' + thumbHtml + '<div class="card-check"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>' + '<div class="card-badge">' + m.ext + '</div>' + '<button class="card-dl" title="Download"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>' + '<div class="card-info"><div class="card-name">' + escHtml(m.filename) + '</div>' + '<div class="card-meta"><span>' + m.ext + '</span>' + (dims ? '<span>' + dims + '</span>' : '') + '</div></div></div>';
  }
  grid.innerHTML = html;
  grid.querySelectorAll(".media-card").forEach(function (card) {
    card.addEventListener("click", function () { toggleSelect(card.dataset.url); });
    var dlBtn = card.querySelector(".card-dl");
    if (dlBtn) { dlBtn.addEventListener("click", function (e) { e.stopPropagation(); var item = visible[parseInt(card.dataset.index)]; if (item) downloadOne(item.url, item.filename); }); }
    var checkEl = card.querySelector(".card-check");
    if (checkEl) { checkEl.addEventListener("click", function (e) { e.stopPropagation(); toggleSelect(card.dataset.url); }); }
  });
}

function toggleSelect(url) {
  if (selectedUrls.has(url)) selectedUrls.delete(url); else selectedUrls.add(url);
  renderGrid(); updateDlButton();
  var visible = getVisibleMedia();
  S("#selectAll").checked = visible.length > 0 && visible.every(function (m) { return selectedUrls.has(m.url); });
}

function updateDlButton() {
  var btn = S("#dlSelected"); var count = selectedUrls.size;
  btn.disabled = count === 0;
  btn.textContent = count > 0 ? "Download " + count + " File" + (count !== 1 ? "s" : "") : "Download Selected";
}

function downloadOne(url, filename) {
  chrome.runtime.sendMessage({ action: "download", url: url, filename: filename });
  showToast("Downloading " + filename);
}

function downloadSelected() {
  var visible = getVisibleMedia().filter(function (m) { return selectedUrls.has(m.url); });
  for (var i = 0; i < visible.length; i++) {
    (function (m, delay) {
      setTimeout(function () {
        if (m.inline && m.svgData) { chrome.runtime.sendMessage({ action: "download", url: URL.createObjectURL(new Blob([m.svgData], { type: "image/svg+xml" })), filename: m.filename || "inline-svg.svg" }); }
        else { chrome.runtime.sendMessage({ action: "download", url: m.url, filename: m.filename }); }
      }, delay);
    })(visible[i], i * 250);
  }
  showToast("Downloading " + visible.length + " file" + (visible.length !== 1 ? "s" : "") + "\u2026");
}

function showToast(msg) { S("#status").textContent = msg; setTimeout(function () { S("#status").textContent = ""; }, 3000); }
