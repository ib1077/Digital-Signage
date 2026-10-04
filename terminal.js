"use strict";
// Prototype controls. Content paths and default timeouts live in terminal-config.json.
window.Terminal = (() => {
  const shell = document.querySelector("#terminal");
  const panel = document.querySelector("#infoPanel");
  const body = document.querySelector("#infoBody");
  const heading = document.querySelector("#infoHeading");
  const dialog = document.querySelector("#staffDialog");
  const trigger = document.querySelector("#staffTrigger");
  const hint = document.querySelector("#returnHint");
  let active = false, current = "guide", defaults = [], internal = false;
  let idleTimer, hintTimer, holdTimer, generation = 0, config;
  let idleMs = 60000;
  const configReady = fetch("./terminal-config.json").then(r => {
    if (!r.ok) throw new Error("情報メニューの設定を読み込めません");
    return r.json();
  }).then(data => {
    config = data;
    idleMs = data.idleReturnMs;
    document.querySelector("#idleSetting").value = String(idleMs);
    return data;
  });
  // Handle rejection here as well, so HOME remains usable if loading fails.
  configReady.catch(() => {});
  function clearIdle() { clearTimeout(idleTimer); clearTimeout(hintTimer); hint.hidden = true; }
  function activity() {
    clearIdle();
    if (!active || current === "guide" || dialog.open) return;
    idleTimer = setTimeout(() => select("guide"), idleMs);
    hintTimer = setTimeout(() => { hint.hidden = false; }, Math.max(0, idleMs - 10000));
  }
  async function fullscreen() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      if (active && screen.orientation?.lock) await screen.orientation.lock("landscape");
    } catch (_) { /* Keep normal playback on browsers without these capabilities. */ }
  }
  function enterGesture() {
    active = true;
    // Called synchronously after primeSpeechFromUserGesture, before any fetch.
    fullscreen();
  }
  function mark(name) {
    current = name;
    shell.dataset.section = name;
    for (const button of shell.querySelectorAll("[data-section]")) {
      button.setAttribute("aria-pressed", String(button.dataset.section === name));
    }
  }
  function onViewerStart(newPages) {
    active = true;
    shell.hidden = false;
    panel.hidden = true;
    body.replaceChildren(); // Unload embedded pages and their animations/listeners.
    if (!internal) { defaults = newPages; mark("guide"); }
    activity();
  }
  function leave() {
    generation++;
    active = false;
    clearIdle();
    cancelHold();
    shell.hidden = true;
    body.replaceChildren();
    if (dialog.open) dialog.close();
    try { screen.orientation?.unlock?.(); } catch (_) {}
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  function pausePlayback() {
    playing = false;
    cancelPage();
    ui.viewer.hidden = true;
    body.replaceChildren();
    panel.hidden = false;
  }
  function message(title, detail) {
    const box = document.createElement("div"); box.className = "pending-content";
    const h = document.createElement("h2"); h.textContent = title;
    const p = document.createElement("p"); p.textContent = detail;
    box.append(h,p); body.replaceChildren(box);
  }
  function embed(url, title) {
    const frame = document.createElement("iframe");
    frame.title = title;
    // Only reviewed local pages. No nested Service Worker or app shell is included.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.src = url;
    frame.addEventListener("load", () => {
      try {
        const doc = frame.contentDocument;
        for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchmove"]) {
          doc.addEventListener(type, activity, {capture:true, passive:true});
        }
      } catch (_) {}
    });
    body.replaceChildren(frame);
  }
  async function select(name) {
    if (!active) return;
    const token = ++generation;
    mark(name);
    pausePlayback();
    heading.textContent = {guide:"案内",ic:"ICカードのご案内",timetable:"時刻表",fare:"運賃",emergency:"避難表示 · 試作"}[name];
    activity();
    try {
      const data = await configReady;
      if (token !== generation || !active) return;
      if (name === "guide" || name === "ic") {
        const list = name === "guide" ? defaults : await loadJson(data.icData);
        if (token !== generation || !active) return;
        internal = true;
        const started = startViewer(list);
        internal = false;
        await started;
      } else if (name === "timetable") {
        heading.textContent = data.timetable.title;
        embed(data.timetable.url, data.timetable.title);
      } else if (name === "emergency" && data.emergency?.url) {
        heading.textContent = "避難表示 · デモ（距離・方向はサンプル）";
        embed(data.emergency.url, "避難表示の試作");
      } else if (name === "fare" && data.fare?.data) {
        const response = await fetch(data.fare.data);
        if (!response.ok) throw new Error("運賃データを取得できません");
        const fares = await response.json();
        if (token !== generation || !active) return;
        FareView.render(body, fares);
      } else {
        message(name === "fare" ? "運賃のご案内" : "避難表示の試作", "準備中です");
      }
    } catch (error) {
      if (token === generation && active) message("表示できませんでした", "左の「案内」から戻れます。");
    }
  }
  function openStaff() {
    cancelHold();
    clearIdle();
    if (!dialog.open) dialog.showModal();
  }
  function cancelHold() { clearTimeout(holdTimer); trigger.classList.remove("holding"); }
  trigger.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    trigger.setPointerCapture(event.pointerId);
    trigger.classList.add("holding");
    holdTimer = setTimeout(openStaff, config?.staffHoldMs || 2000);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) trigger.addEventListener(type, cancelHold);
  trigger.addEventListener("contextmenu", event => event.preventDefault());
  trigger.addEventListener("keydown", event => {
    if (["Enter", " "].includes(event.key) && !event.repeat) { event.preventDefault(); holdTimer = setTimeout(openStaff, config?.staffHoldMs || 2000); }
  });
  trigger.addEventListener("keyup", cancelHold);
  document.querySelector("#managementEntry").addEventListener("click", openStaff);
  document.querySelector("#staffClose").addEventListener("click", () => dialog.close());
  document.querySelector("#staffFullscreen").addEventListener("click", fullscreen);
  document.querySelector("#staffExitFullscreen").addEventListener("click", async () => {
    try { screen.orientation?.unlock?.(); if (document.fullscreenElement) await document.exitFullscreen(); } catch (_) {}
  });
  document.querySelector("#updateButton").addEventListener("click", () => {
    if (active) { playing = false; cancelPage(); }
  });
  document.querySelector("#idleSetting").addEventListener("change", event => { idleMs = Number(event.target.value); activity(); });
  dialog.addEventListener("close", () => { if (active && ["guide", "ic"].includes(current) && !playing) select(current); activity(); });
  for (const button of shell.querySelectorAll("[data-section]")) {
    button.addEventListener("click", () => { primeSpeechFromUserGesture(); select(button.dataset.section); });
  }
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchmove"]) shell.addEventListener(type, activity, {passive:true});
  return {get active(){return active;}, enterGesture, onViewerStart, leave, select};
})();
