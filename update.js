"use strict";
const updateButton = document.querySelector("#updateButton");
const updateStatus = document.querySelector("#updateStatus");
document.querySelector("#appVersion").textContent = "ver. " + globalThis.SIGNAGE_VERSION;
let registrationPromise;
let switching = false;
let updateRequested = false;
function registerOffline() {
  return registrationPromise ||= navigator.serviceWorker.getRegistration("./").then(existing => existing?.updateViaCache === "none" ? existing : navigator.serviceWorker.register("./sw.js", {updateViaCache: "none"})).catch(error => {
    registrationPromise = null;
    throw error;
  });
}
function deadline(promise, ms = 25000) {
  let id;
  return Promise.race([promise, new Promise((_, reject) => { id = setTimeout(() => reject(new Error("timeout")), ms); })]).finally(() => clearTimeout(id));
}
if (!("serviceWorker" in navigator)) {
  updateButton.disabled = true;
  updateStatus.textContent = "この環境ではオフライン保存に対応していません。";
} else {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (switching) location.reload();
  });
  window.addEventListener("load", async () => {
    try {
      await registerOffline();
      await navigator.serviceWorker.ready;
      if (!updateRequested) updateStatus.textContent = "オフライン用の保存が完了しました。";
    } catch (_) {
      if (!updateRequested) updateStatus.textContent = "オフライン保存を確認できません。オンラインで開き直してください。";
    }
  });
  updateButton.addEventListener("click", async () => {
    updateRequested = true;
    updateButton.disabled = true;
    updateStatus.textContent = "更新を確認・取得しています…";
    try {
      if (!navigator.onLine) throw new Error("offline");
      // Unique URL bypasses the offline cache for this explicit update only.
      const response = await deadline(fetch("./version.js?update=" + Date.now(), {cache: "no-store"}));
      if (!response.ok) throw new Error("version unavailable");
      const published = (await response.text()).match(/SIGNAGE_VERSION\s*=\s*"([^"]+)"/)?.[1];
      if (!published) throw new Error("invalid version");
      const registration = await deadline(registerOffline());
      let candidate = registration.installing;
      const track = () => { candidate = registration.installing; };
      registration.addEventListener("updatefound", track);
      try {
        await deadline(registration.update());
        // update() may resolve before updatefound or registration.waiting is set.
        if (published !== globalThis.SIGNAGE_VERSION || candidate || registration.installing) {
          const end = Date.now() + 25000;
          while (!registration.waiting) {
            if (candidate?.state === "redundant") throw new Error("install failed");
            if (Date.now() >= end) throw new Error("new version not ready");
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } finally { registration.removeEventListener("updatefound", track); }
      if (registration.waiting) {
        updateStatus.textContent = "取得完了。更新して再起動します…";
        switching = true;
        registration.waiting.postMessage({type: "ACTIVATE_UPDATE"});
        setTimeout(() => {
          if (switching) {
            switching = false;
            updateButton.disabled = false;
            updateStatus.textContent = "切替を確認できませんでした。もう一度お試しください。";
          }
        }, 15000);
      } else {
        if (published !== globalThis.SIGNAGE_VERSION) throw new Error("new version not ready");
        updateStatus.textContent = "最新版です。再起動します…";
        location.reload();
      }
    } catch (_) {
      switching = false;
      updateStatus.textContent = "更新できませんでした。現在のバージョンを使用します";
      updateButton.disabled = false;
    }
  });
}
