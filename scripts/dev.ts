import { spawn, execSync } from "child_process";
import { createServer } from "vite";

async function main() {
  // Build main process
  execSync("npx tsc -p tsconfig.main.json", { stdio: "inherit" });

  // Start vite dev server
  const vite = await createServer({ configFile: "vite.config.ts" });
  await vite.listen();
  const url = vite.resolvedUrls?.local?.[0] || "http://localhost:5173";
  console.log(`Vite dev server: ${url}`);

  // Start electron
  const electron = spawn("npx", ["electron", "."], {
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER: url },
  });

  electron.on("close", () => {
    vite.close();
    process.exit();
  });
}

main();
