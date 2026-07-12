import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Make a fresh temp dir; caller cleans it up. */
export async function tempDir(prefix = "memoria-test-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/** Recursively remove a temp dir, ignoring errors. */
export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/** Write a file at <root>/<rel>, creating parent dirs. */
export async function writeDoc(
  root: string,
  rel: string,
  content: string,
): Promise<string> {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  return abs;
}
