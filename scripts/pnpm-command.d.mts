export interface PnpmCommandOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  fileExists?: (path: string) => boolean;
}

export function resolvePnpmCommand(
  args: string[],
  options?: PnpmCommandOptions
): { command: string; args: string[] };
