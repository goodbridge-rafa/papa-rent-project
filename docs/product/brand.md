# PAPA RENT — Brand

> Version 1.0 · 2026-09-06 · Brand languages at launch: NL (primary) and EN (secondary).
> Working tagline: **"Als eerste. Altijd."** / **"First. Always."**

---

## 1. Brand story

In the Netherlands, regulated rentals are not lost for lack of merit: they are lost by arriving late and not knowing where to look. A *DirectKans* home can be gone within minutes. A free registration nobody made costs years in the queue. The information exists, scattered across dozens of portals that don't talk to each other.

PAPA RENT is the tenant's side of that asymmetry. We watch every source, normalise everything into a single feed and alert within seconds. Then we step back: **the user applies, with their own account, on the source portal**. We store no passwords, receive no documents and never pretend to be the portal.

The promise is narrow on purpose: **be the first to know**. Everything the brand says follows from that.

---

## 2. Why the name

| Layer | Reading |
|---|---|
| Sound | Two repeated plosive syllables, memorable in NL and EN without translation. Works when spoken on the phone and survives typos |
| Meaning | *Papa* as a figure who keeps watch for you: warm, protective, on your side. Not paternalistic: the app alerts, you decide |
| Phonetic alphabet | "Papa" is the **P** of the NATO phonetic alphabet. It fits the icon: the roofline that forms a **P** |
| Practical | "RENT" names the category without explanation |
| Accepted risks | May sound informal to an institutional audience. Accepted: the customer is the tenant, not the corporation |

**Usage**: `PAPA RENT` as two words, all caps in the wordmark, never "PAPA Rent". In running text: "PAPA RENT". Never "PapaRent", never "Papa-Rent".

---

## 3. Voice and tone

**We are**: warm, direct, pragmatic, honest about limits.
**We are not**: bureaucratic, alarmist, jokey, salesy.

| Principle | Do | Don't |
|---|---|---|
| Direct | "Sluit over 2 uur." | "Let op! De sluitingstermijn van deze woning nadert." |
| Honest | "Tijdens stille uren mis je snelle woningen." | Hide the cost of a choice |
| No bare jargon | "Loting: iedereen maakt evenveel kans." | "Loting." without explanation |
| On the user's side | "Jij reageert zelf. Wij regelen het zoeken." | "Wij regelen alles voor je." (not true) |
| No false urgency | Real countdown, taken from the source | Invented timer, "nog 3 plekken!" |

### Sample lines

| Context | NL | EN |
|---|---|---|
| Tagline | Als eerste. Altijd. | First. Always. |
| Store subtitle | Alle sociale huur en middenhuur van Nederland in één app. | Every social and mid-rent home in the Netherlands, in one app. |
| Push | Nieuw: € 812 in Eindhoven | New: € 812 in Eindhoven |
| Product boundary | Je reageert met je eigen account op {portaal}. | You apply with your own account on {portaal}. |
| Privacy | Geen documenten. Geen wachtwoorden van portalen. Nooit. | No documents. No portal passwords. Ever. |
| Educational | {aantal} regio's zijn gratis. Schrijf je vandaag in — je wachttijd begint nu. | {aantal} regions are free. Register today — your waiting time starts now. |
| Empty state | Nog geen meldingen. We kijken mee — je hoort van ons. | No alerts yet. We're watching — you'll hear from us. |
| Error | Er ging iets mis bij ons. Probeer het zo nog eens. | Something went wrong on our side. Try again in a moment. |

**NL writing rules**: address the user as "je" (never "u"), short sentences, active voice, numbers as digits, currency as `€ 932,93` (thin space, decimal comma), 24 h clock. **EN**: simple international English (B1 level), avoid idioms, and format currency as `nl-NL` in the EN version too (users will compare it with the portal).

---

## 4. Colour

### 4.1 Tokens

| Token | Hex | Use |
|---|---|---|
| `--papa-navy-900` | `#0A1B33` | Dark background, wordmark on light, main text on light |
| `--papa-navy-800` | `#102A4C` | Elevated dark surface |
| `--papa-navy-700` | `#1B4172` | Borders and hover states on dark |
| `--papa-navy-600` | `#2A5AA0` | Links and secondary interactive elements |
| `--papa-orange-500` | `#FF6B1A` | **Papa orange.** Accent, icon, CTA on navy, "new" dot |
| `--papa-orange-600` | `#C2410C` | Orange for **text** and icons on light backgrounds |
| `--papa-orange-400` | `#FF8A47` | Accent on dark backgrounds, pressed states |
| `--papa-cream-50` | `#FBF7F1` | **Warm off-white.** Default light-mode background |
| `--papa-cream-100` | `#F3ECE2` | Secondary surface, chips |
| `--papa-ink` | `#11161C` | Maximum-contrast text (alternative to navy) |
| `--papa-muted` | `#5A6472` | Secondary text on light |
| `--papa-border` | `#D7DCE3` | Dividers on light |
| `--papa-dark-bg` | `#071426` | Dark-mode background |
| `--papa-dark-surface` | `#0E2340` | Card on dark |
| `--papa-dark-text` | `#F2F5F9` | Text on dark |
| `--papa-dark-muted` | `#9AA8BC` | Secondary text on dark |
| `--papa-success` | `#146B46` | "past bij jou", confirmations (text) |
| `--papa-success-bg` | `#1B8A5A` | Success badge fill |
| `--papa-warning` | `#8A5800` | Warning text (closing soon) |
| `--papa-warning-bg` | `#B4740A` | Warning badge fill |
| `--papa-danger` | `#C6362B` | Destructive errors |

### 4.2 Contrast notes (WCAG 2.1, calculated)

| Pair | Ratio | Verdict |
|---|---|---|
| `navy-900` on `cream-50` | **16.2:1** | AAA — default light-mode pairing |
| `muted #5A6472` on `cream-50` | **5.6:1** | AA for normal text |
| `orange-500` on white/cream | **≈ 2.9:1** | ❌ **Fails for text.** Surfaces, large icons and graphics only |
| `orange-600 #C2410C` on `cream-50` | **5.2:1** | AA — this is the light-mode text orange |
| `orange-500` on `navy-900` | **6.1:1** | AA — orange CTA with navy text, or orange text on navy |
| white on `orange-500` | **≈ 2.9:1** | ❌ Never small white text on orange. If the button is orange, the label is `navy-900` |
| `dark-text` on `dark-bg` | **≈ 17:1** | AAA |
| `dark-muted` on `dark-bg` | **7.7:1** | AAA |
| `success #146B46` on `cream-50` | **6.1:1** | AA |
| `warning #8A5800` on `cream-50` | **5.7:1** | AA |
| `danger #C6362B` on `cream-50` | **5.0:1** | AA |

**Hard rule**: orange is an accent, not a text background. Touch targets ≥ 44 × 44 pt. Never use colour as the only carrier of meaning — a segment badge always carries the word (`Sociaal`/`Middenhuur`), not just the colour.

### 4.3 Proportion
Roughly **70 % neutral** (cream or navy), **25 % structural navy**, **5 % orange**. If a screen looks orange, it is wrong.

---

## 5. Typography

**Display: Manrope** (700/800) — geometric, slightly rounded, Dutch in spirit, excellent in all caps for the wordmark.
**Text: Inter** (400/500/600) — tall x-height, tabular figures, legible at 12 px.
Both under the SIL OFL licence, bundled with the app (no CDN, no runtime fetch).

| Role | Font / weight | Size / line height | Use |
|---|---|---|---|
| Display | Manrope 800 | 34 / 40 | Welcome, brand screens |
| H1 | Manrope 700 | 28 / 34 | Screen titles |
| H2 | Manrope 700 | 22 / 28 | Sections |
| H3 | Manrope 600 | 18 / 24 | Blocks in the detail view |
| Body L | Inter 400 | 17 / 24 | Reading text |
| Body | Inter 400 | 15 / 22 | UI default |
| Price | Inter 600 `tabular-nums` | 20 / 26 | Kale huur on the card |
| Label | Inter 600, tracking +0.04em | 13 / 18 | Badges, all caps |
| Caption | Inter 500 | 12 / 16 | Timestamps, source notes |

Rules: at most 3 sizes per screen · numbers always tabular (prices line up in a column) · respect the OS Dynamic Type / font scale up to 200 % without breaking the card · never justify text · line length 45–75 characters.

---

## 6. Icon and wordmark

**Concept**: the Dutch roofline (*gevel*, a sloped gable) drawn as a vertical stem with an arc on the right — the silhouette reads both as a **house** and as the letter **P**. A single stroke, constant weight, slightly rounded corners (2 px radius on a 24 grid), no door, no window, no chimney, no sun.

- **Grid**: 24 × 24, 2 px stroke, clear space = 1 × the height of the "P".
- **Colour**: `orange-500` on navy; `navy-900` on cream. A monochrome version is mandatory.
- **Wordmark**: `PAPA RENT` in Manrope 800, all caps, tracking +0.02em, "PAPA" in navy and "RENT" in orange in light mode (inverted in dark). Horizontal lockup (icon + wordmark) and vertical lockup (icon above).
- **Minimum test**: legible at 16 px in monochrome. If it fails, simplify further.

**App icon**: icon only, orange `#FF6B1A` on `navy-900`, no wordmark, no gradient, no shadow. Full-bleed background (iOS/Android masks crop it). Android adaptive version: foreground = P, background = solid navy. No text in the icon.

**Splash**: `navy-900` background (dark) / `cream-50` (light), wordmark centred, no animation beyond a 150 ms fade. No progress bar.

---

## 7. Do / Don't

**Do**
- Let the price be the strongest element on the card.
- Use orange for one thing per screen: the primary action or the "new" marker.
- Spell out the allocation model on its first mention on each screen.
- Show source and date for any market rule displayed.
- Test every screen in dark mode and at 200 % font scale.

**Don't**
- Don't use stock images of smiling families in homes that don't exist.
- Don't put small white text on orange.
- Don't place the wordmark on a photo without a solid layer underneath.
- Don't invent urgency: no timer without a closing time from the source.
- Don't use any portal's brand (Zig365, WoningNet/DĀK, Vesteda…) as if it were a partnership. Portal names appear as neutral text, never with their logo.
- Don't translate the tagline literally into other languages without native review.
- Don't use emoji in push notifications or titles.

---

## 8. Note on AI image generation

AI image/video generation tools may be used **in a later phase**, never as the source of the identity:

| Allowed use | Forbidden use |
|---|---|
| Icon explorations (roof-P variations) for a human to choose from | Generating the final logo without manual vector redrawing |
| Abstract backgrounds and textures for marketing material | "Real" photos of homes that don't exist, in any listing context |
| Illustrations for empty states and onboarding | Photorealistic faces presented as real users or testimonials |
| App-store mockups and social images | Any image that imitates the identity of a portal or corporation |

All output goes through: (1) human review, (2) vector redrawing if it becomes a brand asset, (3) logging the prompt and date in the asset repository. Generated assets never enter the app bundle without that cycle.
