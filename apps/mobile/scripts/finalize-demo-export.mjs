/**
 * Final step of the demo export: materializes the dynamic routes.
 *
 * `expo export` writes a dynamic route as a single literal file, `listing/[id].html`. A plain
 * static server does not know that `/listing/114` is that file and returns 404. The usual fix
 * would be rewrite rules on the host; here it is not needed: in demo mode the set of ids is closed
 * and known (it comes from the snapshot), so we write a page for each one. The HTML is the same
 * (the page resolves the id from the URL after hydrating) and the result runs on any static
 * host with no configuration at all.
 *
 * Usage: node scripts/finalize-demo-export.mjs [dist-demo]
 */
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const OUT = process.argv[2] ?? "dist-demo";
const DATASET = new URL("../src/lib/demo/dataset.json", import.meta.url);

/** The export's dynamic routes and where to get the ids that fill them. */
const ROUTES = [
  { template: "listing/[id].html", ids: (d) => listingIds(d) },
  { template: "l/[id].html", ids: (d) => listingIds(d) },
  { template: "radar/[id].html", ids: (d) => d.radarIds ?? [] },
];

/** Listing ids present in the snapshot: those with a recorded detail response. */
function listingIds(dataset) {
  return Object.keys(dataset.routes)
    .map((key) => /^\/v1\/listings\/(.+)$/.exec(key)?.[1])
    .filter((id) => typeof id === "string");
}

async function main() {
  const dataset = JSON.parse(await readFile(DATASET, "utf8"));
  let written = 0;

  for (const route of ROUTES) {
    const source = join(OUT, route.template);
    const ids = route.ids(dataset);
    if (ids.length === 0) throw new Error(`no ids for ${route.template}`);
    for (const id of ids) {
      const target = join(OUT, dirname(route.template), `${encodeURIComponent(id)}.html`);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      written += 1;
    }
    console.log(`${route.template} → ${ids.length} pages`);
  }

  // Static hosting convention: 404.html serves whatever does not exist.
  await copyFile(join(OUT, "+not-found.html"), join(OUT, "404.html"));

  // Safety net: if an `[id].html` is left without concrete pages next to it, the export would
  // ship dead routes and nobody would notice until someone tapped a listing.
  const remaining = [];
  for (const dir of new Set(ROUTES.map((r) => dirname(r.template)))) {
    const entries = await readdir(join(OUT, dir));
    if (entries.filter((e) => e.endsWith(".html") && !e.includes("[")).length === 0) {
      remaining.push(dir);
    }
  }
  if (remaining.length > 0) throw new Error(`dynamic routes not materialized: ${remaining}`);

  console.log(`${written} pages materialized + 404.html in ${OUT}`);
}

await main();
