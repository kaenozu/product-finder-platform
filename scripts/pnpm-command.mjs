import { existsSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

/**
 * Resolve pnpm without invoking a shell. On Windows, npm_execpath is available
 * when launched by pnpm; direct `node` execution falls back to Node's Corepack CLI.
 *
 * @param {string[]} args
 * @param {{
 *   platform?: NodeJS.Platform,
 *   env?: NodeJS.ProcessEnv,
 *   execPath?: string,
 *   fileExists?: (path: string) => boolean
 * }} [options]
 * @returns {{ command: string, args: string[] }}
 */
export function resolvePnpmCommand(args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { command: "pnpm", args };

  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  if (env.npm_execpath) return { command: execPath, args: [env.npm_execpath, ...args] };

  const corepackCli = pathWin32.join(
    pathWin32.dirname(execPath),
    "node_modules",
    "corepack",
    "dist",
    "corepack.js"
  );
  const fileExists = options.fileExists ?? existsSync;
  if (fileExists(corepackCli)) {
    return { command: execPath, args: [corepackCli, "pnpm", ...args] };
  }

  throw new Error("Unable to resolve pnpm CLI. Install Corepack or run this script through pnpm.");
}
