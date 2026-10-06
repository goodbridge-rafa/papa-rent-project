import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The app's tests are plain Node on purpose: they cover the web export configuration and demo
 * mode, which is where a silent mistake would do damage (changing native, or pretending a write
 * worked). Rendering React Native here would require a whole runtime and add nothing to these
 * two guarantees.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
