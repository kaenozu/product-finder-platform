import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(root, "worker/pages.ts")],
  outfile: resolve(root, "dist/_worker.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  minify: false,
  sourcemap: false,
  logLevel: "info",
});

// _worker.js は Pages の advanced mode Worker として扱われるため、
// アセット（静的ファイル）としてはアップロードしない。
writeFileSync(resolve(root, "dist/.assetsignore"), "_worker.js\n");
