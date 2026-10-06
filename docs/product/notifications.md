# PAPA RENT — Notifications (push and e-mail)

> Version 1.0 · 2026-09-06 · Rules for content, pacing and deduplication.
> Latency targets: detection p95 ≤ 90 s (JSON sources) · push p95 ≤ 10 s after detection.
> No monetary value or threshold is a literal here: everything comes from `market-rules.md` via variables.
> **Status:** the push and e-mail pipeline is implemented, but no alert has ever been sent to real users. Latency figures are targets, not measurements.

---

## 1. Principles

1. **One notification = one decision.** If the user cannot act, we don't notify.
2. **Price first, place second.** The title carries the essentials even when truncated.
3. **Never notify the same home to the same user twice.** Hard rule, no exceptions (see §5).
4. **Urgency only when it is real.** "sluit over 2 uur" only appears when the source provides a reliable closing time.
5. **No clickbait, no emoji in titles.** At most one emoji in an e-mail body, never in a push.
6. **Silence is a feature.** Quiet hours, daily digest and radar pause are reachable in two taps.

---

## 2. Anatomy and limits

| Field | Practical limit | Rule |
|---|---|---|
| Push title | ≤ 40 characters (iOS truncates at ~41, Android ~45) | Price + city. No app name (the OS already shows it) |
| Push body | ≤ 110 characters | Rooms, m², segment, allocation model, time left |
| Subtitle (iOS) | ≤ 40 characters | Radar name |
| E-mail subject | ≤ 60 characters | Same logic as the push title |
| Preheader | ≤ 90 characters | Complements, doesn't repeat, the subject |

Canonical variables: `{kale}` `{totaal}` `{stad}` `{wijk}` `{kamers}` `{m2}` `{segment}` `{model}` `{portaal}` `{radar}` `{sluit_over}` `{aantal}` `{regio}`.

---

## 3. Push templates

### 3.1 New listing (default)

| | NL | EN |
|---|---|---|
| Title | Nieuw: € {kale} in {stad} | New: € {kale} in {stad} |
| Body | {kamers} kamers · {m2} m² · {segment} · via {portaal} | {kamers} rooms · {m2} m² · {segment} · via {portaal} |
| Subtitle | {radar} | {radar} |

### 3.2 New listing with an eligibility match

| | NL | EN |
|---|---|---|
| Title | Past bij jou: € {kale} in {stad} | Fits you: € {kale} in {stad} |
| Body | {kamers} kamers · {m2} m² · {segment} · via {portaal} | {kamers} rooms · {m2} m² · {segment} · via {portaal} |

### 3.3 Fast model (DirectKans / eerste reageerder)

| | NL | EN |
|---|---|---|
| Title | Direct: € {kale} in {stad} | Direct: € {kale} in {stad} |
| Body | Wie het eerst reageert, krijgt 'm. {kamers} kamers · via {portaal} | First to respond gets it. {kamers} rooms · via {portaal} |

### 3.4 Loting

| | NL | EN |
|---|---|---|
| Title | Loting: € {kale} in {stad} | Lottery: € {kale} in {stad} |
| Body | Inschrijfduur telt niet mee. Sluit over {sluit_over}. | Registration time doesn't count. Closes in {sluit_over}. |

### 3.5 Grouped (> 3 listings in 60 s — see §5.3)

| | NL | EN |
|---|---|---|
| Title | {aantal} nieuwe woningen in {regio} | {aantal} new homes in {regio} |
| Body | Vanaf € {kale} · {segment} · tik om te bekijken | From € {kale} · {segment} · tap to view |

### 3.6 Closing soon (§6)

| | NL | EN |
|---|---|---|
| Title | Sluit over {sluit_over}: {stad} | Closes in {sluit_over}: {stad} |
| Body | € {kale} · {kamers} kamers · je hebt nog niet gereageerd | € {kale} · {kamers} rooms · you haven't applied yet |

### 3.7 Registration nudge (max. 1 per portal, ever)

| | NL | EN |
|---|---|---|
| Title | {portaal} vraagt eerst inschrijving | {portaal} requires registration first |
| Body | Gratis en 5 minuten werk. Je wachttijd begint vandaag. | Free and 5 minutes' work. Your waiting time starts today. |

> Only fire when `fee = 0`. If there is a fee, the nudge lives inside the app (S-12), never in a push.

---

## 4. Instant vs. digest

| Mode | Push | E-mail | When it is the default |
|---|---|---|---|
| **Instant** | yes, per listing | optional, per listing | Default for plans with push (v1: everyone) |
| **Daily digest** | 1 push at 08:00 local | 1 e-mail at 08:00 local | Planned default for the free plan in phase 2; suggested when a radar produces > 100/week |
| **Silent** | none | none | Explicit choice; the radar keeps feeding the feed and the Inbox |

The daily digest never includes a listing that has already closed. If all have closed, the digest is not sent (we don't send empty e-mails).

**Digest push**

| | NL | EN |
|---|---|---|
| Title | {aantal} nieuwe woningen vandaag | {aantal} new homes today |
| Body | {regio} · vanaf € {kale} · {aantal_past} passen bij jou | {regio} · from € {kale} · {aantal_past} fit you |

---

## 5. Deduplication and grouping

### 5.1 Never twice
Dedupe key: `sha256(user_id + listing_fingerprint)`, persisted for 180 days.
`listing_fingerprint` = `source_id + external_id`, falling back to `hash(normalised_address + kale_huur + portal)` when the source has no stable id.

Cases handled:
- **Republication** of the same home by the same portal → no new notification; the card moves up in the feed with the label "opnieuw gepubliceerd / republished".
- **Same home on two sources** (e.g. corporation portal + regional consortium) → a single notification, from the portal with the better application URL; the detail lists both origins.
- **Price correction** at the source → no new notification; update silently and mark "prijs bijgewerkt / price updated" in the detail.
- **Same home matching 2 radars of the same user** → one notification, attributed to the more specific radar.

### 5.2 Volume caps
- Maximum **10 individual pushes per user per hour**; beyond that, everything is grouped.
- Maximum **25 pushes per user per day**; when reached, one final push: "Veel aanbod vandaag — bekijk alles in de app" / "Busy day — see everything in the app".
- If the cap is exceeded 3 days in a row, suggest refining the radar or switching to the digest.

### 5.3 Grouping
If **> 3 listings** match the same radar within **60 s**, send a single grouped push (§3.5) instead of N pushes.
Coalescing window: 60 s from the first item; the push goes out at the end of the window (maximum latency cost: 60 s).
**Exception**: `direct` listings are never grouped or held — they go out individually and immediately, because the home is gone in seconds. `loting`, `punten`, `inschrijfduur`, `motivatie` and `optie` can be grouped: there, what matters is reacting before the deadline, not within seconds (see `docs/knowledge/allocation-models.md`).

### 5.4 OS-level grouping
- iOS: `thread-id = radar_{id}`, higher `relevance-score` for `direct` and `past bij jou`.
- Android: `group = radar_{id}`, a summary notification with the total; separate channels per type (`new`, `closing`, `digest`, `system`) so the user can mute one without losing the rest.

---

## 6. Closing soon

Sent **only** when: (a) the source provides a reliable closing time, (b) the user opened the detail or saved the listing, and (c) has not yet marked it "gereageerd".

| Model | Reminder | Rationale |
|---|---|---|
| DirectKans / eerste reageerder | No reminder — the initial alert is the urgency | The home is gone within minutes; a reminder arrives too late by definition |
| Loting | 1 reminder **2 h** before closing | Typical window of hours/days; the draw ignores seniority, so it is worth insisting |
| Inschrijfduur / puntenmodel | 1 reminder **12 h** before closing | Typical window of days |
| Motivatie | 1 reminder at **24 h** | Requires writing a letter |
| Optiemodel | None | Not a listing with a deadline |

Maximum **1 reminder per listing per user**, always. Closing reminders **break through quiet hours** by default, with their own toggle in Settings ("Urgente sluitingen ook 's nachts" / "Urgent closings at night too", default: on).

---

## 7. Quiet hours

- Configurable per radar; suggested default 23:00–07:00 in the **device's** time zone.
- During quiet hours, normal pushes are **held**, not dropped: delivered at the first active window, grouped into a single push ("{aantal} nieuwe woningen vannacht" / "{aantal} new homes overnight").
- Exceptions that break through: closing reminders (§6) and `direct` listings still open, if the user keeps the toggle on.
- A listing that closed during quiet hours is **not** delivered afterwards — it only goes to the Inbox, marked "gesloten".
- Honest note in the UI: "Tijdens stille uren mis je snelle woningen." / "During quiet hours you'll miss fast listings."

---

## 8. Deep links

| Destination | Scheme | Web fallback |
|---|---|---|
| Listing detail | `paparent://listing/{id}?src={push\|email\|digest}` | `https://app.example.com/l/{id}` |
| A radar's feed | `paparent://radar/{id}` | `https://app.example.com/r/{id}` |
| Inbox | `paparent://inbox` | `https://app.example.com/inbox` |
| Notification settings | `paparent://settings/notifications` | same |
| Registration on a portal | `paparent://portal/{portaal}/register` (opens in-app browser) | Portal URL |

Rules: every e-mail link goes through Universal Links / App Links, so it opens the app when installed.
`src` is always propagated to measure `alert_to_tap`.
A cold start with a deep link opens **the detail**, and "back" goes to the Feed (never closes the app).
If the `id` no longer exists: open the Feed with the toast "Deze woning is niet meer beschikbaar" / "This home is no longer available".

---

## 9. Listing removed or closed

| Event | Push | Feed | Inbox | Detail |
|---|---|---|---|---|
| Closed at the normal deadline | none | disappears after 24 h | stays, marked "gesloten" | banner "Deze woning is gesloten" |
| Removed by the source before the deadline | none | disappears immediately | stays, marked "verwijderd" | banner "niet meer beschikbaar op {portaal}" + CTA disabled |
| Already applied for by the user, then removed | none | moves to "Mijn reacties" | stays | neutral banner, no alarm |
| Source down > 30 min | no push to the user | banner only on affected radars | — | — |

We **never** send a push to say something disappeared. It is noise with no possible action.

---

## 10. E-mail

### 10.1 Types
`instant` (1 listing) · `digest` (daily) · `transactional` (verification, export, deletion, receipt) · `lifecycle` (welcome, radar without results for 14 d). Never marketing without a separate opt-in.

### 10.2 Templates

**Instant**

| Slot | NL | EN |
|---|---|---|
| Subject | Nieuw: € {kale} in {stad} — {kamers} kamers | New: € {kale} in {stad} — {kamers} rooms |
| Preheader | {segment} · {m2} m² · via {portaal} · sluit over {sluit_over} | {segment} · {m2} m² · via {portaal} · closes in {sluit_over} |
| CTA | Bekijk en reageer | View and apply |

**Daily digest**

| Slot | NL | EN |
|---|---|---|
| Subject | {aantal} nieuwe woningen in {regio} | {aantal} new homes in {regio} |
| Preheader | Vanaf € {kale} · {aantal_past} passen bij jou | From € {kale} · {aantal_past} fit you |
| Header | Je overzicht van vandaag | Your listings today |
| Footer | Je krijgt dit omdat je radar "{radar}" actief is. | You're getting this because your radar "{radar}" is active. |

### 10.3 Design principles
- **One column, 600 px, mobile-first.** No two-column layouts.
- **Readable without images**: all essential information in text; thumbnails with real `alt` text ("Woning aan {straat}, {stad}").
- **One CTA per listing**, a solid-background button (not an image), ≥ 44 px tall, AA-contrast text.
- **Dark mode**: colours in `@media (prefers-color-scheme: dark)`; logo as a transparent PNG that works on both backgrounds.
- **No third-party tracking pixels.** Opens are measured only with a first-party pixel, and the decision metric is the click.
- **One-click unsubscribe**, in the footer and the header (`List-Unsubscribe` + `List-Unsubscribe-Post`), separated by type: cancelling the digest does not cancel transactional mail.
- **Plain-text alternative** always generated; an e-mail without a text version is not sent.
- Consistent sender (e.g. `alerts@example.com`), SPF+DKIM+DMARC aligned, a sending domain separate from the corporate domain.
- Footer always includes: why you received it, a link to adjust the radar, a link to turn it off, and the legal address.

### 10.4 Frequency
Maximum **1 instant e-mail every 10 min** per user; beyond that, items are grouped into the next cycle automatically. Digest: 1/day. Lifecycle: at most 1/week.

---

## 11. Decision matrix (executable summary)

```
for each match(user, listing):
  if dedupe_key already exists -> drop
  if listing.closed -> feed/inbox only
  if user.push_off and user.email_off -> feed/inbox only
  if quiet_hours active and not (closing_soon or model == direct) -> hold
  if radar_matches_in_last_60s > 3 and model != direct -> group
  if pushes_in_last_hour >= 10 -> group
  if pushes_today >= 25 -> feed/inbox only + final notice
  else -> send push (template by model and by eligibility_match)
```
