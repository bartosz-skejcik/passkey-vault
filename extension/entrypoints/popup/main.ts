// Plan 08-03: minimal debug harness. This file must NEVER import
// wasm-loader.ts, vault-session.ts, or pv_wasm.js directly, and must never
// call any pv-wasm export itself (D-04) — it only relays a
// `runtime.sendMessage` call to the background context (plan 08-02) and
// displays whatever JSON comes back. All derive/wrap/unwrap logic stays
// exclusively in the background.
import { browser } from 'wxt/browser';

const resultEl = document.querySelector<HTMLPreElement>('#result');
const runButton = document.querySelector<HTMLButtonElement>('#run');
const checkAgainButton = document.querySelector<HTMLButtonElement>('#check-again');

async function runRoundTripSpike(): Promise<void> {
  if (!resultEl) return;

  try {
    const response = await browser.runtime.sendMessage({ kind: 'spike.roundtrip' });
    resultEl.textContent = JSON.stringify(response, null, 2);
  } catch (e: unknown) {
    resultEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

runButton?.addEventListener('click', runRoundTripSpike);
checkAgainButton?.addEventListener('click', runRoundTripSpike);
