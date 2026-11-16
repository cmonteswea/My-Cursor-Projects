/**
 * Offscreen document: plays a short two-tone WebAudio chime on PLAY_CHIME.
 */

function playChime(): void {
  const ctx = new AudioContext();
  const now = ctx.currentTime;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  master.connect(ctx.destination);

  const tone = (freq: number, start: number, dur: number) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.8, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  };

  tone(880, now, 0.22);
  tone(1318.5, now + 0.2, 0.28);

  window.setTimeout(() => {
    void ctx.close();
  }, 800);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "PLAY_CHIME") {
    try {
      playChime();
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }
  return false;
});
