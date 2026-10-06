import { readFileSync } from "node:fs";
import { getAdapter, listAdapters } from "@papa/adapters";
import { loadRegistry, pollableSources } from "@papa/core";
import { createDb } from "@papa/db";
import { Command } from "commander";
import pino from "pino";
import { BrowserFetcher } from "./browser";
import { loadConfig } from "./config";
import { Geocoder } from "./geocode";
import { Http } from "./http";
import { linksFromEnv, notifyOnce, startNotifier, transportsFromEnv } from "./notify/index";
import { latencyReport, sourceHealth } from "./report";
import { runSourceOnce } from "./runner";
import { geocodeCandidate, Scheduler } from "./scheduler";
import { listingsNeedingGeo, syncSources } from "./store";

const cfg = loadConfig();
const log = process.stdout.isTTY
  ? pino({ level: cfg.logLevel, transport: { target: "pino-pretty" } })
  : pino({ level: cfg.logLevel });
const program = new Command().name("papa-engine").description("PAPA RENT · Radar engine");

program
  .command("sources")
  .description(
    "list registry sources and which are pollable (tier A or B with a decision, status live)",
  )
  .action(() => {
    const reg = loadRegistry(cfg.registryPath);
    const pollable = new Set(pollableSources(reg).map((s) => s.slug));
    for (const s of reg.sources) {
      console.log(
        `${pollable.has(s.slug) ? "●" : "○"} ${s.slug.padEnd(30)} ${s.stack.padEnd(9)} tier=${s.tier.padEnd(7)} ${s.status.padEnd(8)} adapter=${s.adapter ?? "-"}`,
      );
    }
    console.log(
      `\n${pollable.size}/${reg.sources.length} pollable · adapters: ${listAdapters().join(", ")}`,
    );
  });

program
  .command("registry:check")
  .description("validate docs/sources/registry.yaml against the schema")
  .action(() => {
    const reg = loadRegistry(cfg.registryPath);
    console.log(`ok: ${reg.sources.length} sources, updated at ${reg.updated_at}`);
  });

program
  .command("once")
  .description("one poll of one source; without --db it is a dry run (prints normalized listings)")
  .requiredOption("-s, --source <slug>")
  .option("--db", "write to the database (DATABASE_URL)")
  .option("--json", "print full JSON instead of the summary")
  .action(async (opts: { source: string; db?: boolean; json?: boolean }) => {
    const reg = loadRegistry(cfg.registryPath);
    const source = reg.sources.find((s) => s.slug === opts.source);
    if (!source) throw new Error(`source not found: ${opts.source}`);
    if (!source.adapter) throw new Error(`source has no adapter: ${opts.source}`);
    const http = new Http(cfg);
    const browser = new BrowserFetcher(cfg, http);
    const db = opts.db ? await createDb(cfg.databaseUrl) : null;
    if (db) await syncSources(db, [source]);
    const out = await runSourceOnce(source, {
      db,
      http,
      browser,
      adapter: getAdapter(source.adapter),
      log,
      userAgent: cfg.userAgent,
      enrichMaxPerRun: db ? 10 : 0,
    });
    await browser.close();
    await http.close();
    if (opts.json) console.log(JSON.stringify(out, null, 2));
    else {
      const { listings, ...summary } = out;
      console.log(summary);
      for (const l of (listings ?? []).slice(0, 15)) {
        console.log(
          `- [${l.segment}/${l.allocationModel}] €${l.priceNet ?? "?"} ${l.title} · ${l.bedrooms ?? "?"}sk · pub ${l.publishedAt ?? "?"} · sluit ${l.closesAt ?? "?"} · ${l.labels.join(",")}`,
        );
      }
      if ((listings?.length ?? 0) > 15) console.log(`… +${(listings?.length ?? 0) - 15}`);
    }
    process.exit(out.ok ? 0 : 1);
  });

program
  .command("run")
  .description("continuous polling of every pollable source (production)")
  .action(async () => {
    const reg = loadRegistry(cfg.registryPath);
    const db = await createDb(cfg.databaseUrl);
    await syncSources(db, reg.sources);
    const http = new Http(cfg);
    const browser = new BrowserFetcher(cfg, http);
    const geocoder = cfg.geocode ? new Geocoder(http, log, cfg.geocodeGapMs) : undefined;
    const sched = new Scheduler(pollableSources(reg), {
      db,
      http,
      log,
      cfg,
      browser,
      ...(geocoder ? { geocoder } : {}),
    });
    sched.start();
    const stopNotifier = startNotifier(db, {
      transports: transportsFromEnv(process.env, log),
      links: linksFromEnv(),
      log,
    });
    const stop = async () => {
      log.info("stopping");
      sched.stop();
      stopNotifier();
      await http.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });

program
  .command("notify:once")
  .description("one notifier cycle: match new events against radars and send due push/email")
  .action(async () => {
    const db = await createDb(cfg.databaseUrl);
    console.log(
      await notifyOnce(db, {
        transports: transportsFromEnv(process.env, log),
        links: linksFromEnv(),
        log,
      }),
    );
    process.exit(0);
  });

program
  .command("report:latency")
  .description("detection latency (first_seen − published) per source over the last N hours")
  .option("-h, --hours <n>", "window in hours", "24")
  .action(async (opts: { hours: string }) => {
    const db = await createDb(cfg.databaseUrl);
    console.table(await latencyReport(db, Number(opts.hours)));
    process.exit(0);
  });

program
  .command("report:health")
  .description("which sources are mute: stopped publishing, dried up or are not being read")
  .option("--all", "also show healthy sources")
  .option("--json", "print the full report as JSON")
  .option("--status <list>", "registry statuses to include", "live")
  .option("--strict", "exit with code 1 if any source is mute or failing")
  .action(async (opts: { all?: boolean; json?: boolean; status: string; strict?: boolean }) => {
    const db = await createDb(cfg.databaseUrl);
    const report = await sourceHealth(db, {
      statuses: opts.status
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (opts.json) console.log(JSON.stringify(report, null, 2));
    else {
      const shown = opts.all ? report.sources : report.sources.filter((s) => s.status !== "ok");
      console.table(
        shown.map((s) => ({
          source: s.sourceSlug,
          status: s.status,
          reason: s.reason,
          active: s.activeListings,
          "new ago": s.silenceS === null ? "—" : humanDuration(s.silenceS),
          tolerance: s.silenceBudgetS === null ? "—" : humanDuration(s.silenceBudgetS),
          "polled ago": s.sinceRunS === null ? "—" : humanDuration(s.sinceRunS),
          error: s.lastError ?? "",
        })),
      );
      const m = report.summary;
      console.log(
        `${m.total} sources · ok ${m.ok} · mute ${m.mute.length} (not publishing ${m.stale}, at zero ${m.empty}) · failing ${m.failing} · no poll ${m.idle} · never ran ${m.neverRan}`,
      );
      if (m.mute.length) console.log(`mute: ${m.mute.join(", ")}`);
    }
    const bad = report.summary.mute.length + report.summary.failing + report.summary.neverRan > 0;
    process.exit(opts.strict && bad ? 1 : 0);
  });

/** "2 d 3 h", "45 min": the report is meant to be read at a glance. */
function humanDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min`;
  const h = Math.floor(s / 3600);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

program
  .command("fixture")
  .description("print a fixture summary (adapter debugging)")
  .requiredOption("-f, --file <path>")
  .action((opts: { file: string }) => {
    const j = JSON.parse(readFileSync(opts.file, "utf8"));
    console.log(Object.keys(j), Array.isArray(j.result) ? `${j.result.length} items` : "");
  });

program
  .command("geocode:backfill")
  .description("resolve municipality/province (PDOK) for active listings that lack them")
  .option("--limit <n>", "maximum listings", "500")
  .action(async (opts: { limit: string }) => {
    const db = await createDb(cfg.databaseUrl);
    const http = new Http(cfg);
    const geocoder = new Geocoder(http, log, cfg.geocodeGapMs);
    const rows = await listingsNeedingGeo(db, Number(opts.limit));
    let done = 0;
    for (const c of rows) if (await geocodeCandidate(db, geocoder, c)) done++;
    await http.close();
    console.log(`geocoded ${done}/${rows.length} (cache ${geocoder.size()})`);
    process.exit(0);
  });

program.parseAsync(process.argv).catch((err) => {
  log.error({ err: String(err) }, "fatal");
  process.exit(1);
});
