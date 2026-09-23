import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

mkdirSync(join(root, "dist"), { recursive: true });
copyFileSync(join(root, "src", "main.js"), join(root, "dist", "main.js"));
