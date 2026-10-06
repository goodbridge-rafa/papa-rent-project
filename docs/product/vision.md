# PAPA RENT — Product vision

> Version 1.0 · 2026-09-06 · UI: NL + EN
> Product document. Monetary values and thresholds live in `docs/knowledge/market-rules.md` (versioned by date). Never hardcode them.
> **Status:** this is a product specification. The ingestion engine has not run 24/7 in production, push and e-mail alerts are implemented but have never been sent to real users, and the public demo uses fictional data. Latency figures below are **targets**, not measurements.

---

## 1. Why

The regulated Dutch rental market is unusual in Western Europe: the tenant's problem is **not a lack of information, it is fragmented information**. Every day, *sociale huur* and regulated *middenhuur* listings appear on dozens of different platforms. None of them talk to each other.

Facts that shape the product:

| Fact | Consequence for the user |
|---|---|
| Dozens of regional consortia, housing corporations, new-build platforms and niche portals, with no unified view | Nobody knows where to look. People search from their current postcode, which is the most expensive strategic mistake |
| *DirectKans* / *eerste reageerder*: in high-pressure areas a home can be taken within minutes | Anyone not alerted quickly never gets into the queue |
| Institutional middenhuur often closes applications once a set number of files has been received | Speed is the product |
| Registration is free in many regions, and registration time starts counting on the day you sign up | Every month without registering is seniority lost for nothing |

Existing tools mostly cover the free market and the private middenhuur published by agents. The social housing stock is poorly covered, and eligibility is rarely explained.

**PAPA RENT is a single search layer for regulated Dutch rentals**: one feed of every *sociale huur* and regulated *middenhuur* listing, with alerts within seconds and one tap to apply on the source portal.

---

## 2. Who it is for

| Persona | Situation | Main pain | What the app solves |
|---|---|---|---|
| **Newcomer / expat in the Randstad** | Arrived 0–24 months ago, zero seniority, works in English | Does not know registration exists, or where, or that *loting* and *DirectKans* ignore seniority | 90 s onboarding, free portals highlighted, filter by allocation model, UI in EN |
| **Young starter, 18–27** | Leaving the parental home, low income, eligible for *jongerenwoningen* | Does not know about age labels or that the 5-year contract is the norm | `jongeren` label in the radar; alerts for listings reserved for the age group |
| **Family above the social ceiling** | Income in the middenhuur band: "can't get social, can't afford the free market" | Does not know the regulated middenhuur segment or who publishes it | Middenhuur as a first-class segment in the feed |
| **Senior 55+/60+** | Looking for *nultreden*, *seniorenwoning*, senior-housing providers | Supply is scattered across niche portals invisible to aggregators | Niche sources integrated; `senior`/`nultreden` labels |
| **Student 16+** | ROOM.nl and student portals; registration possible from age 16 | Finds out too late that registration time could have been building since 16 | Early-registration nudge; student segment |
| **Doorstromer** | Already in social housing, wants to move up to middenhuur | Does not know that doorstromer status is a formal priority at several landlords | Profile marks `doorstromer`; tip to invoke the status explicitly |

**Not for**: people searching the free market above the middenhuur boundary (general listing sites already serve that), people looking for informal *onzelfstandig* rooms as the main product, and investors/landlords.

---

## 3. Jobs to be done

1. *"When a home I qualify for is published, I want to know before everyone else, so I don't miss the only window there is."*
2. *"When I see a listing, I want to understand in 5 seconds whether I can compete and what the competition looks like, so I don't waste time on what isn't for me."*
3. *"When I decide to apply, I want to reach the right form on the right portal in one tap, so I don't lose minutes searching."*
4. *"When I start looking, I want to know where to register today for free, so the seniority clock starts running."*
5. *"When I'm not looking at my phone, I want the app to keep watch for me, without drowning me in notifications."*

---

## 4. The three non-negotiables

### 4.1 Speed
Speed is the product. If we arrive late, nothing else matters.

| Metric | Target | How it is measured |
|---|---|---|
| Detection (JSON sources) | p95 ≤ 90 s after publication | source timestamp → ingestion timestamp |
| Push after detection | p95 ≤ 10 s | ingestion → acceptance by the push provider |
| End to end (JSON) | p95 ≤ 100 s | publication → arrival on the device |
| HTML/bespoke sources | p95 ≤ 5 min (disclosed to the user) | same |

Hard rule: **never promise a number in marketing that telemetry does not support**. Real per-source latency is planned to be shown inside the app (sources screen).

### 4.2 Clarity
A card must be readable in 3 seconds: net rent, city, rooms/m², segment, allocation model, operator, time left before closing, and whether it fits you. No untranslated jargon: *inschrijfduur*, *loting*, *DirectKans* always come with a one-line plain-language explanation.

### 4.3 Simplicity
Onboarding ≤ 90 s. Eligibility profile optional, bands only, ≤ 60 s. Zero uploads, zero documents, zero portal credentials, ever. Persistent login: the app never asks for the password again.

---

## 5. What we deliberately do NOT do

| We don't | Why |
|---|---|
| Apply on the user's behalf (auto-apply) | Violates portal terms, requires credentials and makes the app responsible for a failed application. This is the line that separates us from bots |
| Store portal credentials | Disproportionate security risk; no benefit that speed does not already deliver |
| Receive or host documents (*inkomensverklaring*, contract, BSN) | BSN and income are sensitive data under the GDPR (AVG). We don't touch them |
| Compute eligibility from exact income figures | We work with **bands** only. The exact check belongs to the housing corporation, whose systems block applicants who don't qualify |
| Charge a brokerage fee (*bemiddelingskosten*) | Charging the tenant under a dual mandate is illegal (Art. 7:417 BW) |
| List the free market above the middenhuur boundary | Not our market; general listing sites already serve it |
| Sell leads to agents or landlords | It would destroy the trust that is the product's core asset |
| Give legal advice | We report rules and deadlines with source and date. We are not lawyers |
| Put a paywall in front of users at launch | Monetisation comes later, once there is an installed base |

---

## 6. Success metrics

### North star
**Useful, on-time alerts delivered per active user per week** — an alert that led to a tap on the "Reageren" button.

### Launch dashboard (targets)

| Metric | Definition | v1 target | Red flag |
|---|---|---|---|
| `time_to_alert_p95` | publication → push on device, JSON sources | ≤ 100 s | > 180 s |
| `alert_to_tap` | median between push and opening the detail | ≤ 3 min | > 15 min |
| `tap_to_portal` | % of opened details that reach the "Reageren" button | ≥ 35 % | < 15 % |
| `radars_per_user` | active radars per active user | ≥ 2.0 | < 1.2 |
| `D30_retention` | users who open the app on day 30 | ≥ 35 % | < 20 % |
| `onboarding_completion` | % reaching the feed in the first session | ≥ 85 % | < 70 % |
| `onboarding_time_p50` | welcome → feed | ≤ 90 s | > 150 s |
| `profile_opt_in` | % completing the eligibility profile | ≥ 40 % | < 20 % |
| `notification_opt_out` | % turning off push within 30 d | ≤ 8 % | > 20 % |
| `source_freshness` | % of sources with a successful fetch in the last 24 h | ≥ 99 % | < 95 % |
| `duplicate_alert_rate` | repeat alerts for the same home to the same user | 0 | > 0 |

### Counter-metrics (guardrails)
- **Fatigue**: median pushes/day per user ≤ 6. Above that, suggest refining the radar.
- **Eligibility noise**: < 5 % of listings marked "past bij jou" that the user could not actually take (measured by qualitative survey, not portal data).
- **False silence**: 0 sources silent > 6 h without an internal alarm.

---

## 7. Assumptions to validate before launch

| Assumption | Status | Where it is resolved |
|---|---|---|
| 2026 rent thresholds and the WWS points boundary | **Not verified** | `docs/knowledge/market-rules.md` |
| Portal terms of service allow automated reading | Not verified | Legal review before launch |
| Zig365-based portals expose a stable public JSON feed | Spot-checked during development | `docs/sources/registry.yaml` |
| Middenhuur income bands vary by municipality | Confirmed as variable (municipal regulation) | `market-rules.md`, per municipality |
