/**
 * Dynamic Expo configuration.
 *
 * It exists for one reason: to serve the web build from a sub-path (for example `/demo`) without
 * touching anything native. `experiments.baseUrl` is Expo's official mechanism for this: it
 * prefixes every asset of the static export with the given path.
 *
 * Golden rule: without environment variables this file returns `app.json` untouched.
 * Native builds (EAS, `expo run:*`) never set `PAPA_WEB_BASE_PATH` or `EXPO_PUBLIC_DEMO`,
 * so the iOS and Android configuration is byte for byte the same as before.
 *
 * Variables:
 *   PAPA_WEB_BASE_PATH  sub-path of the web export, starting with "/" and without a trailing "/".
 *                       Empty or unset (the default) serves the export from the root.
 *   EXPO_PUBLIC_DEMO    "1" turns on demo mode (recorded data, writes disabled).
 */

/** @param {string} raw @returns {string} */
function normalizeBasePath(raw) {
  const value = raw.trim();
  if (!value) return "";
  if (!value.startsWith("/")) {
    throw new Error(
      `PAPA_WEB_BASE_PATH must start with "/" (got: ${JSON.stringify(raw)}). ` +
        "Without the leading slash Expo loads assets relative to the page, and a nested " +
        "route can no longer find the bundle.",
    );
  }
  if (value.endsWith("/") && value !== "/") {
    throw new Error(`PAPA_WEB_BASE_PATH must not end with "/" (got: ${JSON.stringify(raw)}).`);
  }
  return value === "/" ? "" : value;
}

module.exports = ({ config }) => {
  const basePath = normalizeBasePath(process.env.PAPA_WEB_BASE_PATH ?? "");
  const demo = (process.env.EXPO_PUBLIC_DEMO ?? "").trim() === "1";

  // Nothing set is the normal case: return `app.json` without touching it.
  if (!basePath && !demo) return config;

  return {
    ...config,
    ...(basePath ? { experiments: { ...config.experiments, baseUrl: basePath } } : {}),
    ...(demo
      ? {
          // The name only changes on the web and only in demo mode: a browser tab or a
          // home-screen icon must not suggest this is the real product.
          web: {
            ...config.web,
            name: "PAPA RENT · demo",
            shortName: "PAPA RENT demo",
            description:
              "Demonstratie van PAPA RENT met fictieve voorbeeldwoningen. Geen echte woningen.",
          },
        }
      : {}),
  };
};
