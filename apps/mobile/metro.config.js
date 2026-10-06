const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

/**
 * Metro configuration: Expo's default plus one module swap.
 *
 * Why: `src/lib/demo/` imports `dataset.json` (the recorded demo responses) at the top of the
 * module. Metro follows the graph and puts everything it reaches in the bundle, even if the code
 * only runs behind `if (config.demo)`. Without this, the real app (iOS, Android and the normal web
 * build) would ship the demo snapshot: dead weight, and demo data inside the production binary.
 *
 * So: outside demo mode, `dataset.json` resolves to an empty stub. The code is the same in both
 * cases; only what the bundler puts inside changes.
 */
const config = getDefaultConfig(__dirname);

const DEMO = (process.env.EXPO_PUBLIC_DEMO ?? "").trim() === "1";
const DATASET = path.join(__dirname, "src", "lib", "demo", "dataset.json");
const STUB = path.join(__dirname, "src", "lib", "demo", "dataset.empty.json");

const inherited = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = inherited ?? context.resolveRequest;
  const resolution = resolve(context, moduleName, platform);
  if (DEMO) return resolution;
  if (resolution?.type === "sourceFile" && path.resolve(resolution.filePath) === DATASET) {
    return { type: "sourceFile", filePath: STUB };
  }
  return resolution;
};

module.exports = config;
