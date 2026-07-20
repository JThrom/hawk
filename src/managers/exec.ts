/**
 * Command execution helper for package-manager queries.
 *
 * Uses Bun.spawn. Captures stdout, tolerates failure, and enforces a timeout
 * so a hung package manager never blocks Hawk.
 */

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function run(
  cmd: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<RunResult> {
  try {
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const timer = setTimeout(() => {
      proc.kill();
    }, timeoutMs);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    clearTimeout(timer);

    return { ok: code === 0, stdout, stderr, code };
  } catch (err) {
    return {
      ok: false,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      code: null,
    };
  }
}

/** Split command output into non-empty, trimmed lines. */
export function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
