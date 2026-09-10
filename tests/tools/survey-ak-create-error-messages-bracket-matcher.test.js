// Regression test for #138: matchBracket()'s brace-depth scan must not desync when a regex literal
// inside a scanned range contains bracket characters -- a `{`, `}`, `(`, or `)` inside `/.../` is
// text, not structure, and must not move the depth counter.

const assert = require("node:assert/strict");

async function loadMatchBracket() {
  const mod = await import("../../tools/benchmark/survey-ak-create-error-messages.mjs");
  return mod.matchBracket;
}

test("a regex literal containing brace/paren characters does not desync brace matching", async () => {
  const matchBracket = await loadMatchBracket();
  const src = "function f() { const re = /\\{[a-z]\\}\\(x\\)/; return re; }";
  const openIndex = src.indexOf("{");
  const close = matchBracket(src, openIndex, "{", "}");
  assert.equal(close, src.lastIndexOf("}"), "should match the function body's own closing brace, not a brace inside the regex");
});

test("division after an identifier is not mistaken for a regex literal", async () => {
  const matchBracket = await loadMatchBracket();
  const src = "function f() { const x = a / b; return { y: 1 }; }";
  const openIndex = src.indexOf("{");
  const close = matchBracket(src, openIndex, "{", "}");
  assert.equal(close, src.lastIndexOf("}"));
});

test("a regex literal after a keyword like `return` is recognized, not read as division", async () => {
  const matchBracket = await loadMatchBracket();
  const src = "function f() { if (x) return /[{(]/.test(x); return false; }";
  const openIndex = src.indexOf("{");
  const close = matchBracket(src, openIndex, "{", "}");
  assert.equal(close, src.lastIndexOf("}"));
});

test("a character class containing an escaped slash does not end the regex early", async () => {
  const matchBracket = await loadMatchBracket();
  const src = "function f() { const re = /[\\/{}]/g; return re; }";
  const openIndex = src.indexOf("{");
  const close = matchBracket(src, openIndex, "{", "}");
  assert.equal(close, src.lastIndexOf("}"));
});
