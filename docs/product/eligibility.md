# PAPA RENT — "past bij jou" logic

> Version 1.0 · 2026-09-06 · Defines how the eligibility signal is computed from **bands**, never from exact values.
> **No threshold appears in this document as a number.** All of them come from `docs/knowledge/market-rules.md`, versioned by effective date.

---

## 1. What this is — and what it is not

| It is | It is not |
|---|---|
| A **guidance signal** to help the user prioritise | An eligibility decision |
| Based only on bands the user declares themselves | Based on documents, BSN or exact income |
| Reversible and optional at any time | A requirement to use the app |
| Explainable in one sentence ("Waarom past dit bij mij?") | A black box |

The real decision belongs to the portal/corporation, whose systems block applicants who don't meet the *passend toewijzen* rules. That is why the app never writes "je komt in aanmerking" (you are entitled). It writes **"past bij jou"** (fits you) and **"waarschijnlijk niet"** (probably not).

Mandatory disclaimer, always visible in the explanation:
- NL: "Indicatie op basis van wat je zelf hebt ingevuld. {portaal} beslist."
- EN: "Indication based on what you entered yourself. {portaal} decides."

---

## 2. Inputs (all optional, all banded)

| Input | Origin | Possible values | Notes |
|---|---|---|---|
| `household_size` | Profile, Q1 | `1`, `2`, `3`, `4`, `5+` | The only exact number accepted, because it determines the applicable *aftoppingsgrens* |
| `income_band` | Profile, Q2 | `A` … `E`, `prefer_not_to_say` | Readable labels, never a free numeric field |
| `is_doorstromer` | Profile, Q3 | `true` / `false` / `unknown` | "Woon je nu in een sociale huurwoning?" |
| `is_sleutelberoep` | Profile, Q4 | `true` / `false` / `unknown` | List of examples, no verification |
| `age` | Derived from the sign-up DOB | integer | The only mandatory sign-up field |
| `is_student` | Derived: uses student portals or ticked it in the profile | `true` / `false` / `unknown` | We never ask for proof of enrolment |

Income bands (`income_band`) are **defined in `market-rules.md`**, per effective year and, where applicable, per municipality. Conceptual structure of the bands, without numbers:

| Band | Meaning |
|---|---|
| `A` | Below the *huurtoeslag* ceiling for the household size |
| `B` | Above `A`, below the DAEB ceiling (extended social) |
| `C` | Above the DAEB ceiling, within the municipality's middenhuur band |
| `D` | Above the top of the municipality's middenhuur band |
| `E` | Don't know / prefer not to say |

> The labels shown to the user are **euro ranges**, generated at runtime from `market-rules.md`. The code only knows the letters.

---

## 3. Facts that come from `market-rules.md`

The canonical source is `docs/knowledge/market-rules.md` (a versioned table with `valid_from`, `confidence` and `status`), exposed to the code by `packages/core/src/market-rules.ts` via `getRule(key, at)`. Each rule carries `value`, `unit`, `validFrom`, `confidence`, `verified`, `source`.

**Keys that already exist in core**

| Key | Use in the logic | confidence |
|---|---|---|
| `liberalisatiegrens` | Boundary between sociale huur and middenhuur (kale huur) | `C`, not verified |
| `middenhuurgrens` | Top of regulated middenhuur | `C`, not verified |
| `wws_social_max_points` / `wws_midden_max_points` | Classification by WWS points, **only when the source publishes the points** | `A`, with a 1-point conflict (see §6) |
| `aftoppingsgrens_1` | Cap for households of 1–2 people | `C` |
| `aftoppingsgrens_2` | Cap for households of 3+ people | `C` |
| `daeb_income_single` / `daeb_income_multi` | Boundary between bands `B` and `C` (DAEB ceiling) | `C` |
| `midden_income_single_max` / `midden_income_multi_max` | Top of band `C` (varies by municipality) | `C` |
| `huurtoeslag_max_rent_under_23` | Specific warning for under-23s | `C` |
| `youth_age_min` / `youth_age_max` | Eligibility for a *jongerenwoning* | `A` |
| `senior_age_min_common` | *Seniorenwoning* when the listing does not state the age (55 or 65) | `A` |
| `registration_age_min` | Minimum registration age at the consortia | `A` |
| `registration_age_min_room` | Minimum student registration age (ROOM.nl) | `A` |

**Keys still to be created** (the logic in §4 depends on them; until they exist, the corresponding dimension returns `unknown`)

| Proposed key | Use |
|---|---|
| `huurtoeslag_income_max_{n}p` | Band `A` boundary per household size |
| `huurtoeslag_max_kale_huur` | Rent ceiling of the home for *huurtoeslag* (currently equal to `liberalisatiegrens`, but they are distinct rules and may diverge) |
| `kwaliteitskortingsgrens` | Lowest tier of the social stratification |
| `midden_income_band_{gemeente}` | Middenhuur income band per municipality (*Huisvestingsverordening*) |
| `groot_gezin_min_personen` | Minimum number of people for *grote gezinnen* |
| `vrije_toewijzingsruimte_pct` | Informational note on the income-ceiling exception |


**Consumption rules**
1. Always read the version **in force on the listing's publication date**, not today's.
2. If `verified_at` is older than **180 days**, or `confidence` is `[C]` without verification: the app **makes no claim** — it degrades to `unknown` (see §6).
3. No value is a literal in app code or in a UI string. Every mention goes through interpolation (`{sociale_grens}`).
4. A value change invalidates the eligibility cache of every open listing and recomputes it.

---

## 4. Decision rules

Each dimension returns `fit` / `no_fit` / `unknown`. No single dimension marks "past bij jou" on its own.

### 4.1 Segment × income band
| Listing | Band `A` or `B` | Band `C` | Band `D` | `E` |
|---|---|---|---|---|
| Sociaal (kale huur ≤ `liberalisatiegrens`) | `fit` | `no_fit`¹ | `no_fit`¹ | `unknown` |
| Middenhuur (between the two thresholds) | `no_fit`² | `fit` | `no_fit`³ | `unknown` |

¹ Documented exception: *vrije toewijzingsruimte* (a percentage of allocations, set in `market-rules.md`) allows income above the ceiling. That is why `no_fit` in social **never hides** the listing unless the user asks; it shows the note "uitzondering mogelijk / exception possible".
² Institutional middenhuur requires income to be a multiple of the monthly rent; income that is too low fails on affordability, not on a legal ceiling. Different message: "inkomen mogelijk te laag voor de verhuurder".
³ Above the top of the municipality's middenhuur band there is usually no legal block, but the municipality may require a *huisvestingsvergunning* with a ceiling. Treat as `unknown` when the municipality is not mapped.

### 4.2 Household size × aftoppingsgrenzen
- `household_size ∈ {1,2}` → compare the kale huur with `aftoppingsgrens_1`.
- `household_size ≥ 3` → compare with `aftoppingsgrens_2`.
- If the kale huur is **above** the applicable *aftoppingsgrens* **and** the band is `A` (eligible for *huurtoeslag*): mark `warn`, not `no_fit`. Copy: "Boven de aftoppingsgrens: mogelijk minder huurtoeslag." / "Above the rent cap: possibly less housing benefit."
- Listing with `label = grote_gezinnen` and `household_size < groot_gezin_min_personen` → hard `no_fit` (it is a rule of the listing, not an estimate).

### 4.3 Age × labels
| Listing label | Rule | Result |
|---|---|---|
| `jongeren` | `age` between `youth_age_min` and `youth_age_max` | outside the range → hard `no_fit` |
| `senioren` | `age ≥` the minimum age **of the listing itself** (55 or 65; never assume) | below → hard `no_fit` |
| `student` / `campus` | `is_student = true` | `false` → hard `no_fit`; `unknown` → `unknown` |
| `nultreden` | No eligibility rule | never produces `no_fit`; it is a preference, shown as a feature |

If the listing carries an age label but **not** the threshold, use `youth_age_min`/`youth_age_max`/`senior_age_min_common` and mark the explanation "op basis van de gebruikelijke regel" / "based on the usual rule".

### 4.4 Doorstromer and sleutelberoep (tips, never filters)
They don't change `fit`/`no_fit`. They add an **actionable tip** in the detail view:
- `is_doorstromer = true` + middenhuur listing → "Noem dat je een sociale huurwoning achterlaat: dat geeft bij sommige verhuurders voorrang." / "Mention that you're leaving a social home: some landlords give priority for that."
- `is_sleutelberoep = true` + listing in a municipality with a quota → "Vermeld je sleutelberoep bij je reactie." / "Mention your key profession when you apply."
- Listing explicitly marked `voorrang: doorstromers` and `is_doorstromer = false` → hard `no_fit` (it is a condition of the listing).

### 4.5 Final composition
```
hard_no  = any dimension with a hard no_fit (age label, student, grote gezinnen, exclusive priority)
soft_no  = income outside the segment's band
unknown  = any missing input OR an unverified threshold (§6)

if hard_no                          -> state NO_FIT
else if soft_no                     -> state UNLIKELY
else if unknown in any dimension    -> state UNKNOWN
else                                -> state FIT ("past bij jou")
```

---

## 5. States and presentation

| State | Card badge | Detail | "verberg wat niet past" filter |
|---|---|---|---|
| `FIT` | green "past bij jou" / "fits you" | Lists the reasons, one line each | kept |
| `UNLIKELY` | no badge | Neutral note: "Inkomen valt waarschijnlijk buiten de band voor deze woning." | hidden (only if the toggle is on) |
| `NO_FIT` | no badge; card dimmed | "Deze woning is voor {label}." | hidden |
| `UNKNOWN` | no badge | "Vul je profiel aan om te zien of dit bij je past." + CTA | kept |

The "Verberg wat niet bij mij past" toggle is **off** by default. We never hide supply without an explicit request — the cost of a false negative (missing the right home) is higher than that of a false positive.

**Mandatory explanation** ("Waarom?" / "Why?"), always available, listing the dimensions evaluated, the reference value used and its date:
- NL: "Sociale huur tot {sociale_grens} · jouw inkomensgroep {band} · huishouden {n}. Bron: {bron}, {datum}."
- EN: "Social housing up to {sociale_grens} · your income band {band} · household of {n}. Source: {source}, {date}."

---

## 6. Degradation when the data is not reliable

| Situation | Behaviour |
|---|---|
| Threshold with `confidence = [C]` and not verified by us | No `FIT`/`UNLIKELY` badge for income rules; only hard labels (age, student, grote gezinnen) still apply |
| `verified_at` > 180 days | Same, plus an internal warning on the sources panel |
| Municipality without `midden_income_band_{gemeente}` | Middenhuur never becomes `UNLIKELY` on income in that municipality |
| Conflicting WWS boundary (1-point discrepancy between sources) | **Don't use WWS points** to classify the segment. Classify only by kale huur, which is what the sources publish |
| Listing without kale huur separate from the total | `UNKNOWN`; never infer kale huur from the total |

Golden rule: **prefer `UNKNOWN` to being wrong**. A wrong badge destroys the trust the whole product depends on.

---

## 7. Privacy

- Nothing beyond the bands is stored. There is no exact-income field in any table.
- No profile data goes to the portals or to third parties; evaluation runs on our backend and, where possible, on the device.
- The profile can be erased on its own ("Wis mijn profiel" / "Erase my profile") without deleting the account.
- The eligibility profile is **not** used for marketing segmentation.
- Under-18s: the DOB is used only for age labels and the minimum age of 16; no other inference.

---

## 8. Edge cases

| Case | Handling |
|---|---|
| Couple where only one partner fills in the profile | `household_size` is the household that will live there; the UI uses "jullie" (plural) in the income question |
| AOW pensioner with assets and low income (*vermogenstoets* exception) | Outside the scope of bands: show an informational note on the detail of social listings above the *aftoppingsgrens*, without changing the state |
| User changes income band | Recompute everything; never re-send a notification for a listing already notified (`notifications.md` §5.1) |
| Listing changes segment after a source correction | Recompute and update silently; no new push |
| 17-year-old student | Can register (minimum 16 at ROOM.nl); 18+ `jongeren` labels stay `no_fit` |
| Portal requires a municipal *huisvestingsvergunning* | Informational note on the detail; never becomes `no_fit` (the permit is requested after allocation) |
