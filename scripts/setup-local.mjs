import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) throw new Error("Tye Studio requires Node.js 22.13 or newer.");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--skip-install") || args.length > 1) throw new Error("Usage: npm run setup:local -- [--skip-install]");
if (!process.env.npm_execpath) throw new Error("Run this setup with npm run setup:local.");

function runNpm(args) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd: projectRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

// Environment/secret files and existing D1/R2 data are never reset or rewritten.
if (!args.includes("--skip-install")) runNpm(["run", "install:ci"]);
else if (!existsSync(path.join(projectRoot, "node_modules/vinext/package.json"))) throw new Error("--skip-install requires installed dependencies. Run npm run setup:local first.");
runNpm(["run", "build"]);
runNpm(["run", "db:migrate:local"]);
console.log("\nLocal setup complete. Start the loopback development server:\n  npm run dev -- --port 5173 --hostname 127.0.0.1\nThen open http://127.0.0.1:5173/signin-with-chatgpt?return_to=%2F\nConnect your Comfy engine in Settings when you want to generate media.");
