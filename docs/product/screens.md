# PAPA RENT — Screen specification

> Version 1.0 · 2026-09-06 · Expo (iOS / Android / web) from a single codebase.
> Each screen: purpose, elements, states, NL+EN copy, edge cases. Copy is **approved sample copy**, not placeholder text.
> Variables in `{braces}`. Monetary values are never literals in code — they come from `market-rules.md`.
> **Status:** this is the target specification. Not every screen is implemented, and the public demo runs on fictional data.

---

## S-01 · Splash
**Purpose** cover the bootstrap without looking like loading.
**Elements** PAPA RENT wordmark centred on navy; no spinner up to 800 ms.
**States** normal (≤ 800 ms) · slow (> 800 ms: feed skeleton) · no session (→ S-02).
**Copy** none.
**Edge cases** bootstrap > 5 s → enter offline from cache; never hang on the splash.

---

## S-02 · Welcome
**Purpose** explain the product in one screen and lead to sign-up.
**Elements** illustration/roofline · headline · 3 bullets · primary CTA · "I already have an account" link · NL/EN selector in the corner.
**States** single.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Headline | Als eerste. Altijd. | First. Always. |
| Sub | Alle sociale huur en middenhuur van Nederland in één app. | Every social and mid-rent home in the Netherlands, in one app. |
| Bullet 1 | Melding binnen seconden na publicatie | Alerted within seconds of publication |
| Bullet 2 | {aantal} regio's, corporaties en verhuurders bij elkaar | {aantal} regions, corporations and landlords in one place |
| Bullet 3 | Jij reageert zelf op het portaal — wij regelen het zoeken | You apply on the portal yourself — we handle the watching |
| CTA | Beginnen | Get started |
| Link | Ik heb al een account | I already have an account |

**Edge cases** language follows the system; if it is not NL, fall back to EN. `{aantal}` is generated from the source registry, never hardcoded.

---

## S-03 · Sign up / Sign in
**Purpose** create an account in < 20 s.
**Elements** Sign in with Apple · Continue with Google · "of / or" divider · e-mail + password · CTA · link to switch between sign-in/create · "wachtwoord vergeten" link.
**States** empty · validating · field error · e-mail already exists · success.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Title | Maak je account | Create your account |
| E-mail | E-mailadres | Email address |
| Password | Wachtwoord (min. 8 tekens) | Password (min. 8 characters) |
| CTA | Account maken | Create account |
| Password error | Wachtwoord moet minstens 8 tekens hebben | Password must be at least 8 characters |
| E-mail in use | Dit e-mailadres heeft al een account. Inloggen? | This email already has an account. Sign in? |

**Edge cases** Apple sign-in is mandatory on iOS when social login is offered; the password is never asked for again (persistent login).

---

## S-04 · Date of birth + terms
**Purpose** capture the only mandatory personal data point and consent.
**Elements** date picker (wheel) · terms checkbox with links · CTA.
**States** empty · under 16 (blocked) · valid.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Title | Wanneer ben je geboren? | When were you born? |
| Help | We gebruiken je leeftijd alleen voor woningen met een leeftijdslabel (jongeren, senioren). | We use your age only for homes with an age label (youth, seniors). |
| Terms | Ik ga akkoord met de voorwaarden en het privacybeleid | I agree to the terms and the privacy policy |
| Block | Je moet minstens 16 jaar zijn om je in te schrijven voor woonruimte. | You must be at least 16 to register for housing. |
| CTA | Doorgaan | Continue |

**Edge cases** DOB editable later in Settings; changing the DOB recomputes age badges.

---

## S-05 · Radar 1/3 — Where
**Purpose** define the radar's geography.
**Elements** search field (municipality/region) · chips for selections · "Bij mij in de buurt" button + radius slider (5/10/25/50 km) · list of popular suggestions · step 1 of 3 indicator.
**States** empty (CTA disabled) · 1+ selections · location permission denied.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Title | Waar wil je wonen? | Where do you want to live? |
| Search | Zoek gemeente of regio | Search municipality or region |
| Near me | Bij mij in de buurt | Near me |
| Radius | Binnen {km} km | Within {km} km |
| Help | Kies gerust meerdere regio's. Buiten de grote steden is de kans groter. | Pick several regions if you like. Outside the big cities your odds are better. |
| Location denied | Zoek dan handmatig op gemeente. | Search by municipality instead. |

**Edge cases** minimum 1 region; no "Skip" on this step.

---

## S-06 · Radar 2/3 — What
**Purpose** define segment, rent ceiling and minimums.
**Elements** segmented control (Sociaal / Middenhuur / Beide) · kale huur slider with marks at the current thresholds · rooms stepper · label chips (senioren, jongeren, student, groot gezin, nultreden) · live match count.
**States** default · no estimated matches · many matches (> 100/week).
**Copy**

| Slot | NL | EN |
|---|---|---|
| Title | Wat zoek je? | What are you looking for? |
| Segment | Sociaal · Middenhuur · Beide | Social · Mid-rent · Both |
| Rent | Maximale kale huur | Maximum base rent |
| Threshold note | Tot {sociale_grens} is sociale huur. Daarboven tot {midden_grens} is middenhuur. | Up to {sociale_grens} is social housing. Above that, up to {midden_grens}, is mid-rent. |
| Rooms | Minimaal {n} kamers | At least {n} rooms |
| Estimate | ≈ {n} woningen per week | ≈ {n} homes per week |
| Zero | Nog geen matches. Probeer een grotere straal of een hogere huur. | No matches yet. Try a wider radius or a higher rent. |

**Edge cases** the slider **reads** the thresholds from the backend; if there is no valid value, it shows plain numbers without a segment label.

---

## S-07 · Radar 3/3 — Alerts
**Purpose** define channel and pace.
**Elements** instant push toggle (on) · e-mail radio (instant / daily digest / none) · quiet hours (from/to) · optional radar name field · final CTA.
**States** default · quiet hours on · automatic name.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Title | Hoe wil je het horen? | How do you want to hear about it? |
| Push | Directe pushmelding | Instant push notification |
| Push sub | Binnen seconden na publicatie. Dit is het verschil tussen wel en niet reageren. | Within seconds of publication. This is the difference between applying and missing out. |
| E-mail | E-mail: direct · dagelijkse samenvatting · geen | Email: instant · daily digest · none |
| Quiet hours | Niet storen van {van} tot {tot} | Do not disturb from {from} to {to} |
| Quiet sub | Urgente sluitingen sturen we wel — die kun je apart uitzetten. | We still send closing-soon alerts — you can turn those off separately. |
| CTA | Klaar, toon woningen | Done, show me homes |

**Edge cases** quiet hours spanning midnight; device time zone, not server time zone.

---

## S-08 · Push permission (pre-prompt)
**Purpose** avoid an irreversible denial of the OS prompt.
**Elements** bell icon · 2 lines · "Meldingen aanzetten" button · "Later" link.
**States** before the prompt · denied (permanent banner in the feed).
**Copy**

| Slot | NL | EN |
|---|---|---|
| Title | Zonder meldingen ben je te laat | Without notifications you're too late |
| Body | Sommige woningen zijn binnen een minuut vergeven. Wij tikken je op de schouder. | Some homes are gone within a minute. We'll tap you on the shoulder. |
| CTA | Meldingen aanzetten | Turn on notifications |
| Decline | Later | Later |
| Denied banner | Meldingen staan uit. Zet ze aan in je instellingen. | Notifications are off. Turn them on in settings. |

**Edge cases** Android 13+ requires explicit permission; web uses Web Push with the same pre-prompt.

---

## S-09 · Feed
**Purpose** the product itself. A chronological list of what matches the radars.
**Elements** header with radar selector · quick-filter chips (Sociaal, Middenhuur, Loting, DirectKans, Past bij jou) · list of cards · pull-to-refresh · "N nieuw" badge · tab bar (Feed, Inbox, Radars, Profiel).
**States** loading (skeleton) · normal · empty (see `ux-flows.md` §10) · offline · no push.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Header | Nieuw aanbod | New listings |
| New | {n} nieuw | {n} new |
| While away | Terwijl je weg was: {n} nieuwe woningen | While you were away: {n} new homes |
| Offline | Geen internet · je ziet opgeslagen woningen | No internet · showing saved homes |
| No matches | Geen matches deze week | No matches this week |

**Edge cases** order is always "nieuwste eerst"; never re-sort by relevance without an explicit request.

---

## S-10 · Feed card
**Purpose** an open/ignore decision in 3 seconds.
**Elements (visual order)** 16:9 thumbnail · line 1: **kale huur** prominent + "totaal {total}" in grey · line 2: city · neighbourhood · line 3: {n} kamers · {m2} m² · badge row: segment (Sociaal/Middenhuur), model (`inschrijfduur` / `punten` / `loting` / `direct` / `motivatie` / `optie`, matching `AllocationModel` in `packages/core`), operator · footer: "nieuw · {t}" on the left, "sluit over {d}" on the right · green "past bij jou" badge when applicable.
**States** new (< 15 min: orange dot) · closing (< 6 h: countdown in orange) · already applied (dimmed + check) · no photo (default roofline image).
**Copy**

| Slot | NL | EN |
|---|---|---|
| Price | € {kale} kale huur | € {kale} base rent |
| Total | totaal € {totaal} | € {totaal} total |
| New | nieuw · {t} geleden | new · {t} ago |
| Closes | sluit over {d} | closes in {d} |
| Match | past bij jou | fits you |
| Applied | Gereageerd | Applied |

**Edge cases** if *servicekosten* are missing, show only the kale huur and the note "servicekosten onbekend / service costs unknown".

---

## S-11 · Listing detail
**Purpose** give all the facts and lead to the portal.
**Elements** gallery · price (kale + servicekosten + total) · facts table (type, m², rooms, floor, energielabel, beschikbaar per) · map with pin · "Hoe wordt deze woning toegewezen?" block explaining the model · eligibility block · registration strip · countdown · sticky CTA at the bottom · "Bekijk op {portaal}" link · share button · save button.
**States** open · closing (< 2 h) · closed · removed at source · partial data.
**Copy**

| Slot | NL | EN |
|---|---|---|
| CTA | Reageren op {portaal} | Apply on {portaal} |
| CTA sub | Je reageert met je eigen account op {portaal}. | You apply with your own account on {portaal}. |
| Model loting | Loting: iedereen maakt evenveel kans, inschrijfduur telt niet. | Lottery: everyone has an equal chance; registration time doesn't count. |
| Model direct | Wie het eerst reageert, krijgt de woning. Wacht niet. | First to respond gets the home. Don't wait. |
| Model inschrijfduur | Inschrijfduur bepaalt de volgorde. | Registration time determines the order. |
| Model punten | Je punten bepalen de volgorde. Reageer minstens 4× per maand. | Your points determine the order. Apply at least 4× a month. |
| Model motivatie | Je schrijft een motivatie. Neem er de tijd voor. | You write a motivation letter. Take your time. |
| Model optie | Je neemt een optie op dit complex en wordt gebeld bij een vrije woning. | You take an option on this complex and get called when one comes free. |
| Closed | Deze woning is gesloten | This listing has closed |
| Removed | Deze woning is niet meer beschikbaar op {portaal} | This home is no longer available on {portaal} |

**Edge cases** partial data never invents values — a missing field appears as "onbekend / unknown".

---

## S-12 · Registration strip (S-11 component)
**Purpose** warn before the tap that the portal requires registration.
**Elements** info icon · text · external link · "I'm already registered" checkbox.
**States** required, free · required, paid · not required (hidden) · unknown.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Free | Inschrijving vereist bij {portaal} · gratis | Registration required at {portaal} · free |
| Paid | Inschrijving vereist bij {portaal} · € {fee} per jaar | Registration required at {portaal} · € {fee} per year |
| Unknown | Controleer of inschrijving nodig is bij {portaal} | Check whether registration is required at {portaal} |
| Link | Nu inschrijven | Register now |
| Checkbox | Ik ben al ingeschreven bij {portaal} | I'm already registered at {portaal} |

**Edge cases** the "already registered" flag is local, per portal, unverified and without credentials.

---

## S-13 · In-app browser
**Purpose** take the user to the exact listing page while preserving the portal session.
**Elements** SFSafariViewController (iOS) / Custom Tabs (Android) / new tab (web) · no custom chrome.
**States** loading · loaded · network failure · 404 at the source.
**Copy** on return, a bottom sheet:

| Slot | NL | EN |
|---|---|---|
| Question | Heb je gereageerd op deze woning? | Did you apply for this home? |
| Yes | Ja, gereageerd | Yes, applied |
| No | Nog niet | Not yet |
| Note | We houden dit alleen voor jou bij. | We only track this for you. |

**Edge cases** never inject scripts, never fill in forms, never read the portal's page.

---

## S-14 · Alerts inbox
**Purpose** a safety net for missed pushes.
**Elements** chronological list of alerts (not listings) · grouped by day · unread in bold · swipe to archive · filter by radar.
**States** empty · with unread · all read.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Title | Meldingen | Alerts |
| Empty | Nog geen meldingen. We kijken mee — je hoort van ons. | No alerts yet. We're watching — you'll hear from us. |
| Group | Vandaag · Gisteren · {datum} | Today · Yesterday · {date} |
| Grouped | {n} nieuwe woningen in {regio} | {n} new homes in {region} |

**Edge cases** an alert for a removed listing stays listed, marked "gesloten / closed".

---

## S-15 · Radar list
**Purpose** manage radars.
**Elements** list with name, one-line summary, alert count for the last 7 d, active/paused toggle · "+ Nieuw radar" button · swipe to duplicate/delete.
**States** 1 radar · several · paused radar · radar with no results in 7 d.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Title | Mijn radars | My radars |
| Summary | {regio} · {segment} · tot € {max} | {region} · {segment} · up to € {max} |
| Counter | {n} meldingen deze week | {n} alerts this week |
| No results | Geen matches deze week — verruimen? | No matches this week — widen it? |
| New | Nieuw radar | New radar |
| Delete | Radar verwijderen? Dit kan niet ongedaan worden. | Delete radar? This can't be undone. |

**Edge cases** unlimited radars during the free phase; when Pro is introduced, existing radars above the limit stay active (grandfathering).

---

## S-16 · Eligibility profile
**Purpose** 4 banded questions, ≤ 60 s.
**Elements** promise screen + 4 single-choice steps + result screen with a filter toggle.
**States** not started · partial · complete · declined ("liever niet zeggen").
**Copy**

| Slot | NL | EN |
|---|---|---|
| Promise | 4 vragen. Geen documenten, nooit. | 4 questions. No documents, ever. |
| Q1 | Met hoeveel mensen ga je wonen? | How many people will live with you? |
| Q2 | In welke inkomensgroep valt jullie bruto jaarinkomen? | Which income band is your gross household income in? |
| Q2 opt-out | Liever niet zeggen | I'd rather not say |
| Q3 | Woon je nu in een sociale huurwoning? | Do you currently rent social housing? |
| Q4 | Werk je in een sleutelberoep (zorg, onderwijs, politie, brandweer)? | Do you work in a key profession (care, education, police, fire)? |
| Result | We tonen nu wat bij je past | We'll now show what fits you |
| Toggle | Verberg wat niet bij mij past | Hide what doesn't fit me |

**Edge cases** never blocks the feed; declining to answer only turns off the badge and degrades nothing else.

---

## S-17 · "Wat je klaar moet hebben" checklist
**Purpose** explain what the portal will ask for, without ever receiving anything.
**Elements** read-only list per allocation model · source and date note.
**States** social · institutional middenhuur · student.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Title | Wat je klaar moet hebben | What to have ready |
| Note | Alleen ter informatie. Je uploadt niets in deze app — nooit. | For information only. You never upload anything in this app. |
| Social | Inkomensverklaring (Belastingdienst), uittreksel BRP | Income statement (tax office), municipal registration extract |
| Middenhuur | 3 loonstroken, werkgeversverklaring, bankafschriften | 3 payslips, employer's statement, bank statements |
| Source | Bron: {bron} · bijgewerkt {datum} | Source: {source} · updated {date} |

**Edge cases** if the source is more than 180 days out of date, show a warning instead of the content.

---

## S-18 · Settings
**Purpose** one place for everything.
**Elements** sections: Radars · Profiel · Meldingen · Taal (NL/EN) · Abonnement · Bronnen (per-source latency) · Juridisch · Privacy (export/delete) · Beveiliging (Face ID) · Uitloggen.
**States** normal · active subscription · expired subscription.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Title | Instellingen | Settings |
| Language | Taal | Language |
| Sources | Bronnen en snelheid | Sources and speed |
| Security | Vergrendel met Face ID | Lock with Face ID |
| Sign out | Uitloggen | Sign out |
| Version | Versie {versie} · {build} | Version {version} · {build} |

**Edge cases** switching language reloads the UI without losing state; currency and date format follow `nl-NL` in both languages.

---

## S-19 · Subscription (phase 2, planned)
**Purpose** convert without coercion.
**Elements** two columns Gratis/Pro · monthly and yearly price · IAP CTA · "Herstel aankoop" · terms link.
**States** non-subscriber · subscriber · grace period · restoring.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Title | Sneller zijn dan de rest | Be faster than the rest |
| Gratis | 1 radar · dagelijkse samenvatting | 1 radar · daily digest |
| Pro | Onbeperkt radars · directe push en e-mail | Unlimited radars · instant push and email |
| Price | € {prijs} per maand, maandelijks opzegbaar | € {price} per month, cancel anytime |
| CTA | Pro nemen | Get Pro |
| Restore | Aankoop herstellen | Restore purchase |

**Edge cases** no fake countdown, no invented struck-through price; cancellation leads to the store's subscription management.

---

## S-20 · Privacy: export / delete
**Purpose** comply with the GDPR (AVG) without artificial friction.
**Elements** two buttons separated by a divider · explanation of each · typed confirmation for deletion.
**States** idle · export queued · deletion confirmed.
**Copy**

| Slot | NL | EN |
|---|---|---|
| Export | Exporteer mijn gegevens | Export my data |
| Export sub | Je krijgt binnen 24 uur een e-mail met je gegevens. | You'll get an email with your data within 24 hours. |
| Delete | Verwijder mijn account | Delete my account |
| Delete sub | Je radars, meldingen en profiel worden gewist. | Your radars, alerts and profile will be erased. |
| Confirmation | Typ VERWIJDER om te bevestigen | Type DELETE to confirm |
| Subscription | Let op: je abonnement stop je in de App Store / Google Play. | Note: cancel your subscription in the App Store / Google Play. |

**Edge cases** 7-day recovery via link; after that, irreversible purge.

---

## S-21 · Error states (global component)
**Purpose** a single pattern for every failure.
**Elements** icon · one sentence · one action · (optional) link to source status.
**States** offline · session expired · source unavailable · listing removed · server error · IAP failed.
**Copy** see the error table in `ux-flows.md` §11.
**Edge cases** never show a technical code, stack trace or internal service name; never blame the user.
