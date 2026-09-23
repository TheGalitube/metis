import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");

test("sidebar and browser chrome use the J.A.R.V.I.S. Mk3.1 brand", () => {
  const shell = readFileSync(path.join(root, "components/app-shell.tsx"), "utf8");
  const wordmark = readFileSync(path.join(root, "components/jarvis-wordmark.tsx"), "utf8");
  const layout = readFileSync(path.join(root, "app/layout.tsx"), "utf8");
  const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
  assert.match(shell, /<JarvisWordmark \/>/);
  assert.match(wordmark, /J\.A\.R\.V\.I\.S\./);
  assert.match(wordmark, /MK3\.1/);
  assert.match(layout, /jarvis-mark\.svg/);
  assert.match(css, /\.jarvis-wordmark \{/);
  assert.doesNotMatch(shell, /Μῆτις/);
});
