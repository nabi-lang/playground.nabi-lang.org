// Builds the editor's highlighting from nabi-syntax into static/ts/:
// the tree-sitter grammar as wasm, its highlight queries, and the
// web-tree-sitter runtime's wasm (package.json pins its version).
//
//   node scripts/sync-grammar.mjs                  build at the commit in nabi-syntax.rev
//   node scripts/sync-grammar.mjs --from DIR       build from a nabi-syntax checkout, pin its HEAD
//   node scripts/sync-grammar.mjs --check [--from DIR]
//                                                  fail if static/ts/ differs from the source
//
// Needs the tree-sitter CLI (tree-sitter build --wasm fetches its own
// wasi-sdk). Never edit static/ts/ by hand: change nabi-syntax, then sync,
// as the editors do (nabi.vim, nabi.vscode, nabi.zed).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const revFile = path.join(root, "nabi-syntax.rev");
const out = path.join(root, "static", "ts");

const args = process.argv.slice(2);
const check = args.includes("--check");
const at = args.indexOf("--from");
const from = at >= 0 ? path.resolve(args[at + 1] ?? "") : null;

const run = (cmd, a, cwd) => execFileSync(cmd, a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

// The grammar's directory (tree-sitter/nabi) at the pinned commit.
async function grammar() {
  if (from) return path.join(from, "tree-sitter", "nabi");
  const rev = fs.readFileSync(revFile, "utf8").trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nabi-syntax-"));
  const url = `https://codeload.github.com/nabi-lang/nabi-syntax/tar.gz/${rev}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
  fs.writeFileSync(path.join(tmp, "src.tar.gz"), Buffer.from(await r.arrayBuffer()));
  run("tar", ["-xzf", "src.tar.gz", "--strip-components=1"], tmp);
  return path.join(tmp, "tree-sitter", "nabi");
}

const dir = await grammar();
const want = {
  "highlights.scm": fs.readFileSync(path.join(dir, "queries", "highlights.scm")),
  "web-tree-sitter.wasm": fs.readFileSync(path.join(root, "node_modules", "web-tree-sitter", "web-tree-sitter.wasm")),
};
let differ = 0;
if (check) {
  // The grammar's wasm is not byte for byte reproducible: check that it
  // is there; the queries and the runtime must match.
  if (!fs.existsSync(path.join(out, "tree-sitter-nabi.wasm"))) {
    console.log("static/ts/tree-sitter-nabi.wasm is missing; run node scripts/sync-grammar.mjs");
    differ++;
  }
  for (const [name, data] of Object.entries(want)) {
    const dest = path.join(out, name);
    if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(data)) {
      console.log(`static/ts/${name} differs from the source; run node scripts/sync-grammar.mjs`);
      differ++;
    }
  }
} else {
  fs.mkdirSync(out, { recursive: true });
  run("tree-sitter", ["build", "--wasm", "-o", path.join(out, "tree-sitter-nabi.wasm")], dir);
  for (const [name, data] of Object.entries(want)) fs.writeFileSync(path.join(out, name), data);
  console.log("static/ts/ updated");
  if (from) {
    const git = (...a) => run("git", ["-C", from, ...a]);
    if (git("status", "--porcelain", "tree-sitter")) console.log(`warning: ${from}/tree-sitter has uncommitted changes`);
    fs.writeFileSync(revFile, git("rev-parse", "HEAD") + "\n");
  }
  console.log(`nabi-syntax.rev: ${fs.readFileSync(revFile, "utf8").trim()}`);
}
process.exit(differ ? 1 : 0);
