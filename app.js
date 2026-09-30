"use strict";

const APP_MODE = "station";

const SETTINGS = {
  language: "ja-JP",
  rate: 0.82,
  pitch: 1.05,
  volume: 1,
  silentPageWhenSpeechModeMs: 5000,
  imageTimeoutMs: 8000
};

const ui = {
  menu: document.querySelector("#menu"),
  viewer: document.querySelector("#viewer"),
  contentList: document.querySelector("#contentList"),
  folderBtn: document.querySelector("#folderBtn"),
  folderInput: document.querySelector("#folderInput"),
  menuStatus: document.querySelector("#menuStatus"),
  homeBtn: document.querySelector("#homeBtn"),
  mainImage: document.querySelector("#mainImage"),
  prevBtn: document.querySelector("#prevBtn"),
  nextBtn: document.querySelector("#nextBtn"),
  prevThumb: document.querySelector("#prevThumb"),
  nextThumb: document.querySelector("#nextThumb"),
  pageDots: document.querySelector("#pageDots")
};

let pages = [];
let currentPage = 0;
let playing = false;
let runId = 0;
let timer = null;
let wakeLock = null;
let importedUrls = [];
let speechPrimed = false;
const pendingWaits = new Set();

function cancelPage() {
  runId += 1;
  for (const finish of [...pendingWaits]) finish();
  if (timer) clearTimeout(timer);
  timer = null;
  window.speechSynthesis?.cancel?.();
}

function primeSpeechFromUserGesture() {
  if (!("speechSynthesis" in window) || speechPrimed) return;
  try {
    // iPhone/Safari対策：ユーザーのタップ処理の中でSpeechSynthesisへ一度触れる。
    const u = new SpeechSynthesisUtterance(" ");
    u.lang = SETTINGS.language;
    u.volume = 0;
    u.rate = 10;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    speechPrimed = true;
  } catch (_) {}
}

function selectedTiming() {
  return document.querySelector('input[name="timing"]:checked')?.value || "10000";
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url} を読み込めません`);
  const data = await response.json();
  return normalizePages(data.pages || data);
}

function normalizePages(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(p => ({
      image: String(p.image || "").trim(),
      speech: String(p.speech ?? p.text ?? "").trim()
    }))
    .filter(p => p.image);
}

function clearImportedUrls() {
  importedUrls.forEach(url => URL.revokeObjectURL(url));
  importedUrls = [];
}

function basename(path) {
  return String(path || "").replace(/\\/g, "/").split("/").pop();
}

function parseTxt(text) {
  return text.split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith("#"))
    .map(line => {
      const pos = line.indexOf("|");
      return pos < 0 ? null : {
        image: line.slice(0, pos).trim(),
        speech: line.slice(pos + 1).trim()
      };
    }).filter(Boolean);
}

async function importFolder(fileList) {
  clearImportedUrls();
  const files = Array.from(fileList || []);
  if (!files.length) throw new Error("ファイルが選択されていません");

  const byName = new Map();
  const imageFiles = files.filter(f => f.type.startsWith("image/"));
  for (const f of imageFiles) {
    const url = URL.createObjectURL(f);
    importedUrls.push(url);
    byName.set(f.name, url);
    byName.set(f.webkitRelativePath || f.name, url);
    byName.set(basename(f.webkitRelativePath || f.name), url);
  }

  let rawPages = [];
  const jsonFile = files.find(f => f.name.toLowerCase() === "book.json");
  const txtFile = files.find(f => f.name.toLowerCase() === "book.txt");

  if (jsonFile) {
    const data = JSON.parse(await jsonFile.text());
    rawPages = normalizePages(data.pages || data);
  } else if (txtFile) {
    rawPages = parseTxt(await txtFile.text());
  } else {
    rawPages = imageFiles
      .sort((a,b) => a.name.localeCompare(b.name, "ja", { numeric: true }))
      .map(f => ({ image: f.name, speech: "" }));
  }

  const resolved = rawPages.map(p => ({
    image: byName.get(p.image) || byName.get(basename(p.image)) || p.image,
    speech: p.speech || ""
  })).filter(p => p.image);

  if (!resolved.length) throw new Error("表示できる画像がありません");
  return resolved;
}

function waitForImage(src) {
  return new Promise(resolve => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      pendingWaits.delete(done);
      if (ui.mainImage.onload === done) {
        ui.mainImage.onload = null;
        ui.mainImage.onerror = null;
      }
      resolve();
    };
    const timeout = setTimeout(done, SETTINGS.imageTimeoutMs);
    pendingWaits.add(done);
    ui.mainImage.onload = done;
    ui.mainImage.onerror = done;
    ui.mainImage.src = src;
    if (ui.mainImage.complete) done();
  });
}

function getJapaneseVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find(v => v.lang.toLowerCase() === "ja-jp")
    || voices.find(v => v.lang.toLowerCase().startsWith("ja"))
    || null;
}

function speak(text, token) {
  return new Promise(resolve => {
    if (!text || !playing || token !== runId || !("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SETTINGS.language;
    u.rate = SETTINGS.rate;
    u.pitch = SETTINGS.pitch;
    u.volume = SETTINGS.volume;
    const voice = getJapaneseVoice();
    if (voice) u.voice = voice;
    const done = () => {
      pendingWaits.delete(done);
      u.onend = null;
      u.onerror = null;
      resolve();
    };
    pendingWaits.add(done);
    u.onend = done;
    u.onerror = done;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

function wait(ms, token) {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      timer = null;
      pendingWaits.delete(done);
      resolve(playing && token === runId);
    };
    pendingWaits.add(done);
    timer = setTimeout(done, ms);
  });
}

function renderDots() {
  ui.pageDots.innerHTML = "";
  if (pages.length <= 1) { ui.pageDots.hidden = true; return; }
  ui.pageDots.hidden = false;
  if (ui.viewer.dataset.mode === "story" || pages.length > 12) {
    ui.pageDots.textContent = `${currentPage + 1} / ${pages.length}`;
    return;
  }
  pages.forEach((_, i) => {
    const dot = document.createElement("i");
    if (i === currentPage) dot.className = "active";
    ui.pageDots.appendChild(dot);
  });
}

function updatePeeks() {
  const show = pages.length > 1;
  ui.prevBtn.hidden = !show;
  ui.nextBtn.hidden = !show;
  if (!show) return;
  const prev = (currentPage - 1 + pages.length) % pages.length;
  const next = (currentPage + 1) % pages.length;
  ui.prevThumb.src = pages[prev].image;
  ui.nextThumb.src = pages[next].image;
  ui.prevBtn.setAttribute("aria-label", `前のページ（${prev + 1} / ${pages.length}）`);
  ui.nextBtn.setAttribute("aria-label", `次のページ（${next + 1} / ${pages.length}）`);
}

async function showPage(index, token, autoAdvance = true) {
  if (!playing || token !== runId || !pages.length) return;
  currentPage = (index + pages.length) % pages.length;
  renderDots();
  updatePeeks();
  const page = pages[currentPage];
  await waitForImage(page.image);
  if (!playing || token !== runId) return;

  const timing = selectedTiming();
  const start = performance.now();
  if (page.speech) await speak(page.speech, token);
  if (!playing || token !== runId || !autoAdvance) return;

  let remain = 0;
  if (timing === "speech") {
    remain = page.speech ? 0 : SETTINGS.silentPageWhenSpeechModeMs;
  } else {
    const target = Number(timing);
    remain = Math.max(0, target - (performance.now() - start));
  }

  if (remain > 0) {
    const ok = await wait(remain, token);
    if (!ok) return;
  }
  if (!playing || token !== runId) return;
  showPage(currentPage + 1, token, true);
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch (_) {}
}

async function startViewer(newPages, mode = APP_MODE) {
  if (!newPages.length) throw new Error("表示するページがありません");
  cancelPage();
  const token = runId;
  ui.viewer.dataset.mode = mode;
  pages = newPages;
  currentPage = 0;
  playing = true;
  ui.menu.hidden = true;
  ui.viewer.hidden = false;
  await requestWakeLock();
  showPage(0, token, true);
}

function stopViewer() {
  playing = false;
  cancelPage();
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  ui.viewer.hidden = true;
  ui.menu.hidden = false;
  ui.menuStatus.textContent = "モードを選んでください。";
}

async function openBuiltin(url) {
  primeSpeechFromUserGesture();
  try {
    ui.menuStatus.textContent = "読み込み中…";
    const newPages = await loadJson(url);
    await startViewer(newPages, APP_MODE);
  } catch (e) {
    ui.menuStatus.textContent = e.message;
  }
}

async function loadCatalog() {
  try {
    const response = await fetch("./catalog.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("一覧を読み込めません");
    const items = await response.json();
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mode-button content-button";
      button.textContent = item.title + (item.data ? "" : "（準備中）");
      button.disabled = !item.data;
      if (item.data) button.addEventListener("click", () => openBuiltin(item.data));
      ui.contentList.appendChild(button);
    }
  } catch (error) { ui.menuStatus.textContent = error.message; }
}
loadCatalog();
ui.folderBtn.addEventListener("click", () => {
  primeSpeechFromUserGesture();
  ui.folderInput.click();
});

ui.folderInput.addEventListener("change", async () => {
  try {
    ui.menuStatus.textContent = "フォルダを読み込み中…";
    const imported = await importFolder(ui.folderInput.files);
    await startViewer(imported);
  } catch (e) {
    ui.menuStatus.textContent = e.message;
  } finally {
    ui.folderInput.value = "";
  }
});

ui.homeBtn.addEventListener("click", stopViewer);
ui.prevBtn.addEventListener("click", () => {
  if (!playing) return;
  cancelPage();
  showPage(currentPage - 1, runId, true);
});
ui.nextBtn.addEventListener("click", () => {
  if (!playing) return;
  cancelPage();
  showPage(currentPage + 1, runId, true);
});

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && playing) {
    await requestWakeLock();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
