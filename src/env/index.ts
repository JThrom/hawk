/**
 * Aggregated environment detection.
 */

import type { PackageManagerId } from "../catalog/types.ts";
import { detectOS, type OSInfo } from "./os.ts";
import { detectTerminal, type TerminalInfo } from "./terminal.ts";
import { detectMultiplexer, type MultiplexerInfo } from "./multiplexer.ts";
import { detectPackageManagers } from "./package-managers.ts";

export interface Environment {
  os: OSInfo;
  terminal: TerminalInfo;
  multiplexer: MultiplexerInfo;
  packageManagers: PackageManagerId[];
}

export function detectEnvironment(): Environment {
  return {
    os: detectOS(),
    terminal: detectTerminal(),
    multiplexer: detectMultiplexer(),
    packageManagers: detectPackageManagers(),
  };
}

export * from "./os.ts";
export * from "./terminal.ts";
export * from "./multiplexer.ts";
export * from "./package-managers.ts";
export * from "./path.ts";
