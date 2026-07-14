// Client-side download without a server round-trip (06-RESEARCH.md's
// verified Blob + URL.createObjectURL + synthetic <a download> pattern) --
// no fetch(), no server involvement, matches the static-export/no-SSR
// constraint that already rules out any server-side file generation.
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Firefox historically ignores .click() on an anchor that is not in the
  // DOM -- append before clicking, then remove. Revoking the object URL in
  // the same tick can race the browser's async fetch of the blob and
  // cancel the download in some browsers, so defer it.
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
