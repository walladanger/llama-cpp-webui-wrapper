import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

mkdirSync(join(root, "dist", "runtimes"), { recursive: true });
copyFileSync(join(root, "src", "main.js"), join(root, "dist", "main.js"));
for (const file of readdirSync(join(root, "src", "runtimes"))) {
  if (file.endsWith(".js")) copyFileSync(join(root, "src", "runtimes", file), join(root, "dist", "runtimes", file));
}
