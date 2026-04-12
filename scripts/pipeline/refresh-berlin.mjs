import { spawn } from "node:child_process";
import { logInfo, logWarn, parseArgs } from "./_utils.mjs";

function runStep(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const resume = Boolean(args.resume);
  const useHeuristic = Boolean(args["force-heuristic"]);

  const steps = [
    ["node", ["scripts/pipeline/import-berlin.mjs", ...(resume ? ["--resume"] : [])]],
    ["node", ["scripts/pipeline/classify-establishments.mjs", ...(resume ? ["--resume"] : [])]],
    ["node", ["scripts/pipeline/seed-canonical-products.mjs"]],
    ["node", ["scripts/pipeline/enrich-websites.mjs", ...(resume ? ["--resume"] : [])]],
    ["node", ["scripts/pipeline/generate-rule-candidates.mjs", ...(resume ? ["--resume"] : [])]],
    [
      "node",
      [
        "scripts/pipeline/generate-ai-candidates.mjs",
        ...(resume ? ["--resume"] : []),
        ...(useHeuristic ? ["--force-heuristic"] : [])
      ]
    ],
    ["node", ["scripts/pipeline/cleanup-legacy-ai-labels.mjs"]],
    ["node", ["scripts/pipeline/merge-candidates.mjs", ...(resume ? ["--resume"] : [])]],
    ["node", ["scripts/pipeline/build-search-dataset.mjs"]]
  ];

  logInfo("Running full Berlin refresh pipeline", {
    resume,
    useHeuristic
  });

  for (const [command, commandArgs] of steps) {
    logInfo(`Running step: ${command} ${commandArgs.join(" ")}`);
    // eslint-disable-next-line no-await-in-loop
    await runStep(command, commandArgs);
  }

  logInfo("Berlin refresh pipeline completed");
}

main().catch((error) => {
  logWarn("Berlin refresh pipeline failed", String(error));
  process.exit(1);
});
