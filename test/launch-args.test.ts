import { test, expect } from "bun:test";
import { buildLaunchArgs } from "../src/launch/launcher.ts";
import type { AppEntry } from "../src/catalog/types.ts";

function app(launch: AppEntry["launch"]): AppEntry {
  return {
    id: "x",
    name: "X",
    description: "d",
    categories: ["misc"],
    binaries: ["x"],
    launch,
  };
}

test("positional arg appended as value", () => {
  const e = app({ args: [{ name: "path" }] });
  expect(buildLaunchArgs(e, { path: "~/proj" })).toEqual(["~/proj"]);
});

test("flag arg appended as flag + value", () => {
  const e = app({ args: [{ name: "repo", flag: "-p" }] });
  expect(buildLaunchArgs(e, { repo: "/tmp/r" })).toEqual(["-p", "/tmp/r"]);
});

test("empty optional value is skipped", () => {
  const e = app({ args: [{ name: "path" }] });
  expect(buildLaunchArgs(e, { path: "  " })).toEqual([]);
});

test("default used when value missing", () => {
  const e = app({ args: [{ name: "path", default: "." }] });
  expect(buildLaunchArgs(e, {})).toEqual(["."]);
});

test("multiple args preserve order", () => {
  const e = app({ args: [{ name: "a" }, { name: "b", flag: "--b" }] });
  expect(buildLaunchArgs(e, { a: "1", b: "2" })).toEqual(["1", "--b", "2"]);
});

test("no launch spec yields no args", () => {
  expect(buildLaunchArgs(app(undefined), { path: "x" })).toEqual([]);
});
