/**
 * The game screen as HTML. Pure (no node: built-ins), so the terminal-in-a-tab server (`web.mjs`)
 * and the phone app (`browser.js`) draw the same screen the same way.
 */
const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The game's 24-bit ANSI screen as HTML spans. Reads only what `screen.js` writes:
 * `38;2;r;g;b` (foreground), `48;2;r;g;b` (background) and `0` (reset).
 *
 * `cells: true` wraps every character in its own span so the phone board can size each
 * glyph as a square tile (letter-spacing cannot fill a tile background and left black voids).
 */
export function ansiToHtml(text, { cells = false } = {}) {
  let fg = null;
  let bg = null;
  let out = "";
  const parts = String(text).split(/\u001b\[([0-9;]*)m/);
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 1) {
      const codes = parts[i].split(";").map(Number);
      for (let c = 0; c < codes.length; c += 1) {
        if (codes[c] === 0 || parts[i] === "") { fg = null; bg = null; }
        else if ((codes[c] === 38 || codes[c] === 48) && codes[c + 1] === 2) {
          const rgb = `rgb(${codes[c + 2]},${codes[c + 3]},${codes[c + 4]})`;
          if (codes[c] === 38) fg = rgb; else bg = rgb;
          c += 4;
        }
      }
      continue;
    }
    if (!parts[i]) continue;
    const style = [fg && `color:${fg}`, bg && `background:${bg}`].filter(Boolean).join(";");
    if (!cells) {
      out += style ? `<span style="${style}">${escapeHtml(parts[i])}</span>` : escapeHtml(parts[i]);
      continue;
    }
    for (const char of parts[i]) {
      const body = escapeHtml(char);
      out += style ? `<span style="${style}">${body}</span>` : `<span>${body}</span>`;
    }
  }
  return out;
}
