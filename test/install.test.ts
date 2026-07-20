import { test, expect } from "bun:test";
import {
  installCandidates,
  allDeclaredInstalls,
  cycleIndex,
} from "../src/install/select.ts";
import { planInstall } from "../src/install/installer.ts";
import { DEFAULT_CONFIG } from "../src/config/schema.ts";
import type { AppEntry } from "../src/catalog/types.ts";

const app: AppEntry = {
  id: "gitui",
  name: "gitui",
  description: "git tui",
  categories: ["git"],
  binaries: ["gitui"],
  install: {
    cargo: "cargo install gitui",
    brew: "brew install gitui",
    apt: "apt install gitui",
  },
};

test("candidates intersect declared installs with available managers, ordered by preference", () => {
  // Only brew + apt available; preference puts brew before apt.
  const candidates = installCandidates(app, DEFAULT_CONFIG, ["brew", "apt"]);
  expect(candidates.map((c) => c.manager)).toEqual(["brew", "apt"]);
  expect(candidates[0]!.command).toBe("brew install gitui");
});

test("cargo preferred first when available", () => {
  const candidates = installCandidates(app, DEFAULT_CONFIG, ["apt", "cargo", "brew"]);
  expect(candidates[0]!.manager).toBe("cargo");
});

test("no available manager yields no candidates", () => {
  const candidates = installCandidates(app, DEFAULT_CONFIG, ["pipx"]);
  expect(candidates.length).toBe(0);
});

test("allDeclaredInstalls returns every command regardless of availability", () => {
  expect(allDeclaredInstalls(app).length).toBe(3);
});

test("app without install has no candidates", () => {
  const bare: AppEntry = { ...app, install: undefined };
  expect(installCandidates(bare, DEFAULT_CONFIG, ["brew"]).length).toBe(0);
  expect(allDeclaredInstalls(bare).length).toBe(0);
});

test("cycleIndex wraps", () => {
  expect(cycleIndex(0, 3)).toBe(1);
  expect(cycleIndex(2, 3)).toBe(0);
  expect(cycleIndex(0, 0)).toBe(0);
});

test("install plan wraps command to keep window open and stays out of auth", () => {
  const plan = planInstall({ manager: "brew", command: "brew install gitui" });
  // In this test env (no multiplexer) the plan runs inline.
  expect(["tmux-window", "zellij-window", "inline"]).toContain(plan.mode);
  expect(plan.installCommand).toBe("brew install gitui");
  // Command is executed via a shell so the registry command string works as-is.
  expect(plan.command[0]).toBe("sh");
});
