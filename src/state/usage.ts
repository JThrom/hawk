/**
 * Local usage tracking (privacy: never leaves the machine).
 *
 * Records launch counts + last-launched timestamps per app id. Powers the
 * Recent category (and future Frequent).
 */

import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dataDir, ensureDir } from "../paths.ts";

const USAGE_FILE = "usage.json";
const USAGE_VERSION = 1;

export interface UsageRecord {
  count: number;
  lastLaunched: number;
}

interface UsageShape {
  version: number;
  records: Record<string, UsageRecord>;
}

function usagePath(): string {
  return join(dataDir(), USAGE_FILE);
}

export class UsageStore {
  private records: Record<string, UsageRecord>;

  private constructor(records: Record<string, UsageRecord>) {
    this.records = records;
  }

  static load(): UsageStore {
    const path = usagePath();
    if (!existsSync(path)) return new UsageStore({});
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as UsageShape;
      if (data.version !== USAGE_VERSION) return new UsageStore({});
      return new UsageStore(data.records ?? {});
    } catch {
      return new UsageStore({});
    }
  }

  private persist(): void {
    ensureDir(dataDir());
    const data: UsageShape = { version: USAGE_VERSION, records: this.records };
    try {
      writeFileSync(usagePath(), JSON.stringify(data));
    } catch {
      // Non-fatal.
    }
  }

  /** Record a launch of `id`. */
  recordLaunch(id: string): void {
    const existing = this.records[id];
    this.records[id] = {
      count: (existing?.count ?? 0) + 1,
      lastLaunched: Date.now(),
    };
    this.persist();
  }

  get(id: string): UsageRecord | undefined {
    return this.records[id];
  }

  /** App ids ordered by most-recently launched. */
  recentIds(limit = 20): string[] {
    return Object.entries(this.records)
      .sort((a, b) => b[1].lastLaunched - a[1].lastLaunched)
      .slice(0, limit)
      .map(([id]) => id);
  }

  /** App ids ordered by launch count (Frequent, future use). */
  frequentIds(limit = 20): string[] {
    return Object.entries(this.records)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([id]) => id);
  }
}
