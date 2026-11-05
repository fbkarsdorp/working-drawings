/* Presenter view hook (experimental). On this laptop, P opens presenter.html: a second window
 * with a live copy of the deck, your notes (notes.md) and a timer. The two windows talk over a
 * BroadcastChannel: the deck reports which sheet is up, the presenter sends keys back.
 *
 * To remove the presenter view: delete this file and presenter.html, and the <script> line
 * that loads this file in index.html. Nothing else depends on it. */
(function () {
  "use strict";
  const local = ["localhost", "127.0.0.1", ""].includes(location.hostname) || new URLSearchParams(location.search).has("live");
  if (!local || !("BroadcastChannel" in window)) return;   // online there are no notes
  const chan = new BroadcastChannel("working-drawings-presenter");
  // the copy inside the presenter window (index.html?mirror): it only follows the deck
  if (new URLSearchParams(location.search).has("mirror")) {
    const small = document.getElementById("small");
    if (small) small.hidden = true;   // the copy is small, but it is not a phone
    chan.onmessage = ({ data }) => {
      const d = window.__deck, s = data.state;
      if (!d || !s) return;
      if (s.lang && s.lang !== document.documentElement.lang) dispatchEvent(new KeyboardEvent("keydown", { key: "l" }));
      if (d.cur() !== s.cur) d.go(s.cur);
    };
    chan.postMessage({ hello: true });
    return;
  }
  const NAMES = { cover: "Cover", origin: "Two conversations", prompt: "The prompt", contact: "Experiments", hours: "Hours, not years", scarce: "What is scarce", data: "Data is the interface", plan: "What this asks of us", end: "Thank you", meta: "This deck", index: "Appendix" };
  const keyOf = (s) => (s.kind === "plate" ? (s.main ? "dayafter" : "app") : s.kind);
  const nameOf = (s) => (!s ? "" : s.kind === "plate" ? (s.main ? "The day after" : s.app.name) : NAMES[s.kind] || s.kind);
  let last = "";
  function state() {
    const d = window.__deck;
    if (!d) return null;
    const slides = d.slides(), cur = d.cur(), S = slides[cur], main = slides.findIndex((s) => s.kind === "index");
    const inMain = cur < main;
    return { cur, lang: document.documentElement.lang, key: keyOf(S), name: nameOf(S), n: inMain ? cur + 1 : null, main, next: inMain && cur + 1 < main ? nameOf(slides[cur + 1]) : "" };
  }
  setInterval(() => {
    const s = state();
    if (!s) return;
    const sig = JSON.stringify(s);
    if (sig !== last) { last = sig; chan.postMessage({ state: s }); }
  }, 120);
  chan.onmessage = ({ data }) => {
    if (data.hello) last = "";   // resend the state to a presenter that just opened
    if (data.key) dispatchEvent(new KeyboardEvent("keydown", { key: data.key, shiftKey: !!data.shift }));
  };
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !e.isTrusted) return;
    if (e.key.toLowerCase() === "p") window.open("presenter.html", "wd-presenter", "width=1280,height=800");
  });
})();
