import { rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
await Promise.all(
  ["dist", "dist-electron"].map((directory) =>
    rm(path.join(root, directory), { recursive: true, force: true })
  )
);
