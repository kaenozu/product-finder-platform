import { describe, expect, it } from "vitest";
import { win32 } from "node:path";
import { resolvePnpmCommand } from "../../scripts/pnpm-command.mjs";

describe("resolvePnpmCommand", () => {
  it("Windowsのnode直接起動では同梱Corepackをshellなしで使う", () => {
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const expectedCli = win32.join(
      win32.dirname(execPath),
      "node_modules",
      "corepack",
      "dist",
      "corepack.js"
    );

    const command = resolvePnpmCommand(["build"], {
      platform: "win32",
      env: {},
      execPath,
      fileExists: (path: string) => path === expectedCli,
    });

    expect(command).toEqual({ command: execPath, args: [expectedCli, "pnpm", "build"] });
  });

  it("pnpm経由のWindows起動ではnpm_execpathを使う", () => {
    const command = resolvePnpmCommand(["build"], {
      platform: "win32",
      env: { npm_execpath: "C:\\pnpm\\pnpm.cjs" },
      execPath: "C:\\node\\node.exe",
      fileExists: () => false,
    });

    expect(command.args).toEqual(["C:\\pnpm\\pnpm.cjs", "build"]);
  });
});
