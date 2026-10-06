import { humanDuration } from "./time";

export type Locale = "nl" | "en";

export interface ListingForTemplate {
  id: number;
  title: string;
  city: string | null;
  municipality: string | null;
  priceNet: number | null;
  bedrooms: number | null;
  areaM2: number | null;
  segment: string;
  allocationModel: string;
  /** The source closes the listing on the first reaction (in practice, a `direct`). */
  closesAfterFirstReaction?: boolean | null;
  closesAt: string | null;
  sourceSlug: string;
  sourceName?: string | null;
  url: string;
}

export interface Links {
  appScheme: string; // paparent
  webUrl: string; // https://app.example.com
}

const eur = (n: number | null) =>
  n === null
    ? "?"
    : n.toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const segmentLabel = (s: string, l: Locale) =>
  ({
    social: l === "nl" ? "sociale huur" : "social housing",
    midden: "middenhuur",
    free: l === "nl" ? "vrije sector" : "free sector",
  })[s] ?? s;

export function deepLink(links: Links, listingId: number) {
  return {
    app: `${links.appScheme}://listing/${listingId}`,
    web: `${links.webUrl}/l/${listingId}`,
  };
}

/**
 * Push channels (§5.4): the user can mute one without losing the rest.
 * `new` = one push per new listing · `digest` = one push summarising several (grouped, quiet hours, cap)
 * `closing` = closing reminder (§6) · `system` = notices from the service itself (e.g. daily cap).
 * Channel registration on Android is on the app side; here we only tag the payload.
 */
export type PushChannel = "new" | "closing" | "digest" | "system";

export interface PushContent {
  title: string;
  body: string;
  subtitle?: string;
  channelId: PushChannel;
  data: Record<string, unknown>;
}

/** docs/product/notifications.md §3.1, §3.3, §3.4 */
export function pushForListing(
  l: ListingForTemplate,
  radarName: string,
  locale: Locale,
  links: Links,
  now = new Date(),
): PushContent {
  const stad = l.city ?? l.municipality ?? "";
  const kale = eur(l.priceNet);
  const portaal = l.sourceName ?? l.sourceSlug;
  const kamers = l.bedrooms !== null ? `${l.bedrooms + 1}` : "?";
  const m2 = l.areaM2 !== null ? ` · ${Math.round(l.areaM2)} m²` : "";
  const data = { listingId: l.id, ...deepLink(links, l.id), model: l.allocationModel };
  if (l.allocationModel === "direct") {
    return {
      title: `Direct: € ${kale} in ${stad}`,
      body:
        locale === "nl"
          ? `Wie het eerst reageert, krijgt 'm. ${kamers} kamers · via ${portaal}`
          : `First to respond gets it. ${kamers} rooms · via ${portaal}`,
      subtitle: radarName,
      channelId: "new",
      data,
    };
  }
  if (l.allocationModel === "loting" && l.closesAt) {
    const left = humanDuration(new Date(l.closesAt).getTime() - now.getTime(), locale);
    return {
      title: locale === "nl" ? `Loting: € ${kale} in ${stad}` : `Lottery: € ${kale} in ${stad}`,
      body:
        locale === "nl"
          ? `Inschrijfduur telt niet mee. Sluit over ${left}.`
          : `Registration time doesn't count. Closes in ${left}.`,
      subtitle: radarName,
      channelId: "new",
      data,
    };
  }
  return {
    title: locale === "nl" ? `Nieuw: € ${kale} in ${stad}` : `New: € ${kale} in ${stad}`,
    body:
      locale === "nl"
        ? `${kamers} kamers${m2} · ${segmentLabel(l.segment, locale)} · via ${portaal}`
        : `${kamers} rooms${m2} · ${segmentLabel(l.segment, locale)} · via ${portaal}`,
    subtitle: radarName,
    channelId: "new",
    data,
  };
}

/** §3.5 grouped. Always on the `digest` channel: it is a push summarising several listings. */
export function pushGrouped(
  items: ListingForTemplate[],
  regio: string,
  locale: Locale,
  links: Links,
): PushContent {
  const min = Math.min(...items.map((i) => i.priceNet ?? Number.POSITIVE_INFINITY));
  const seg = [...new Set(items.map((i) => i.segment))]
    .map((s) => segmentLabel(s, locale))
    .join(" + ");
  const woning =
    locale === "nl"
      ? items.length === 1
        ? "woning"
        : "woningen"
      : items.length === 1
        ? "home"
        : "homes";
  return {
    title:
      locale === "nl"
        ? `${items.length} nieuwe ${woning} in ${regio}`
        : `${items.length} new ${woning} in ${regio}`,
    body:
      locale === "nl"
        ? `Vanaf € ${eur(Number.isFinite(min) ? min : null)} · ${seg} · tik om te bekijken`
        : `From € ${eur(Number.isFinite(min) ? min : null)} · ${seg} · tap to view`,
    channelId: "digest",
    data: {
      grouped: true,
      listingIds: items.map((i) => i.id),
      app: `${links.appScheme}://inbox`,
      web: `${links.webUrl}/inbox`,
    },
  };
}

/** §3.6 closing soon. `closing` channel. */
export function pushClosingSoon(
  l: ListingForTemplate,
  radarName: string,
  locale: Locale,
  links: Links,
  now = new Date(),
): PushContent {
  const stad = l.city ?? l.municipality ?? "";
  const left = l.closesAt
    ? humanDuration(new Date(l.closesAt).getTime() - now.getTime(), locale)
    : "";
  const kamers = l.bedrooms !== null ? `${l.bedrooms + 1}` : "?";
  return {
    title: locale === "nl" ? `Sluit over ${left}: ${stad}` : `Closes in ${left}: ${stad}`,
    body:
      locale === "nl"
        ? `€ ${eur(l.priceNet)} · ${kamers} kamers · je hebt nog niet gereageerd`
        : `€ ${eur(l.priceNet)} · ${kamers} rooms · you haven't applied yet`,
    subtitle: radarName,
    channelId: "closing",
    data: { listingId: l.id, ...deepLink(links, l.id), model: l.allocationModel, closing: true },
  };
}

/**
 * §5.2: when the daily cap is hit, a single final push with what was left undelivered.
 * `system` channel: not a listing, a service notice.
 */
export function pushDailyCapReached(remaining: number, locale: Locale, links: Links): PushContent {
  const woning =
    locale === "nl"
      ? remaining === 1
        ? "woning"
        : "woningen"
      : remaining === 1
        ? "home"
        : "homes";
  return {
    title: locale === "nl" ? "Veel aanbod vandaag" : "Busy day",
    body:
      locale === "nl"
        ? `Nog ${remaining} ${woning} — bekijk alles in de app.`
        : `${remaining} more ${woning} — see everything in the app.`,
    channelId: "system",
    data: {
      capped: remaining,
      app: `${links.appScheme}://inbox`,
      web: `${links.webUrl}/inbox`,
    },
  };
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

function listingBlock(
  l: ListingForTemplate,
  locale: Locale,
  links: Links,
  now: Date,
): { text: string; html: string } {
  const stad = l.city ?? l.municipality ?? "";
  const left = l.closesAt
    ? humanDuration(new Date(l.closesAt).getTime() - now.getTime(), locale)
    : null;
  const meta = [
    `€ ${eur(l.priceNet)}`,
    l.bedrooms !== null
      ? locale === "nl"
        ? `${l.bedrooms + 1} kamers`
        : `${l.bedrooms + 1} rooms`
      : null,
    l.areaM2 !== null ? `${Math.round(l.areaM2)} m²` : null,
    segmentLabel(l.segment, locale),
    l.allocationModel !== "unknown" ? l.allocationModel : null,
    left ? (locale === "nl" ? `sluit over ${left}` : `closes in ${left}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const web = deepLink(links, l.id).web;
  return {
    text: `${l.title} (${stad})\n${meta}\n${locale === "nl" ? "Bekijken en reageren" : "View and apply"}: ${web}\n`,
    html: `<p style="margin:0 0 4px"><a href="${web}" style="font-weight:600;color:#0B1F3A;text-decoration:none">${esc(l.title)}</a> <span style="color:#666">· ${esc(stad)}</span><br><span style="color:#333">${esc(meta)}</span><br><a href="${web}" style="color:#FF6A1A">${locale === "nl" ? "Bekijken en reageren →" : "View and apply →"}</a></p>`,
  };
}

function wrap(bodyHtml: string, locale: Locale, links: Links): string {
  const foot =
    locale === "nl"
      ? `Je krijgt deze e-mail omdat je een Radar hebt ingesteld in PAPA RENT. Aanpassen of stoppen kan in de app. <a href="${links.webUrl}/privacy">Privacy</a>`
      : `You receive this e-mail because you set up a Radar in PAPA RENT. Change or stop it in the app. <a href="${links.webUrl}/privacy">Privacy</a>`;
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.45;color:#111;max-width:560px"><div style="font-weight:800;font-size:18px;color:#0B1F3A;margin-bottom:12px">PAPA RENT</div>${bodyHtml}<p style="font-size:12px;color:#777;margin-top:20px">${foot}</p></div>`;
}

export function emailSingle(
  l: ListingForTemplate,
  radarName: string,
  locale: Locale,
  links: Links,
  now = new Date(),
): EmailContent {
  const b = listingBlock(l, locale, links, now);
  const stad = l.city ?? l.municipality ?? "";
  return {
    subject:
      locale === "nl"
        ? `Nieuw: € ${eur(l.priceNet)} in ${stad} · ${radarName}`
        : `New: € ${eur(l.priceNet)} in ${stad} · ${radarName}`,
    text: b.text,
    html: wrap(b.html, locale, links),
  };
}

export function emailDigest(
  items: ListingForTemplate[],
  locale: Locale,
  links: Links,
  now = new Date(),
): EmailContent {
  const blocks = items.map((l) => listingBlock(l, locale, links, now));
  return {
    subject:
      locale === "nl"
        ? `${items.length} nieuwe woningen vandaag`
        : `${items.length} new homes today`,
    text: blocks.map((b) => b.text).join("\n"),
    html: wrap(
      blocks
        .map((b) => b.html)
        .join('<hr style="border:0;border-top:1px solid #eee;margin:10px 0">'),
      locale,
      links,
    ),
  };
}
