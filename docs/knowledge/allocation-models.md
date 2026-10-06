# Allocation models and alert urgency

Each source declares its `allocation_models` in `docs/sources/registry.yaml`. This document turns each model into a practical **alert-urgency** rule: the notifier should react differently depending on how a listing is allocated. The urgency rules are product design, not legal facts; local rules always come from the source and the municipality's housing bylaw (*Huisvestingsverordening*).

## The six models

| Model (registry key) | Common names | What decides who gets the home | Alert urgency |
|---|---|---|---|
| `direct` | DirectKans / Direct te huur / Eerste reageerder | The first eligible person to respond | **Seconds.** Alert immediately on publication, no batching, no digest. |
| `loting` | Loting (lottery) | A random draw among all eligible respondents, independent of registration time | **Until the closing date** (`closingDate`). Responding is required, but timing within the window does not change the odds. Alert on publication, remind near closing. |
| `inschrijfduur` | Aanbodmodel / Inschrijfduur / Meettijd | Length of continuous registration | **Until the closing date**, with **low urgency for newcomers**: in high-demand cities a short registration rarely wins. Alert anyway (so users start building registration time), but do not frame it as an opportunity about to be lost. |
| `motivatie` | Reactie met motivatie | A committee assesses fit with the project (co-living, senior, community) | **Until the closing date**; the relevant action is writing a good letter, not clicking fast. Alert early enough to prepare it. |
| `optie` | Optiemodel | The applicant holds a preference option on a specific complex and is contacted as units become available | **No immediate deadline**: the relevant alert is "an option opened in this complex". Low urgency, high niche relevance. |
| `punten` | Puntenmodel / Zoekpunten | A combination of points (waiting, search activity, situation, starter) | **Until the closing date**, plus a structural urgency: keeping search-activity points depends on applying regularly. The product should alert on the user's own monthly application pace, not only on new listings. |

## Practical rule per urgency (for the notifier)

1. **`direct`** → immediate push, top priority, never aggregated with other listings. The only model where seconds truly matter.
2. **`loting`**, **`motivatie`** and **`punten`** → alert on publication, but the value is making sure the user responds **before `closingDate`**. A reminder near closing beats raw speed.
3. **`inschrijfduur`** → always alert, but add realistic context about the user's registration time, to avoid false urgency in a channel that is structurally slow for newcomers.
4. **`optie`** → lowest push priority, highest long-term "watch" priority per complex.

## Points model (`punten`)

Used in the Amsterdam region through the regional allocation platform. Components:

| Point type | How it is earned |
|---|---|
| *Wachtpunten* (waiting points) | Years of uninterrupted registration |
| *Zoekpunten* (search points) | Regularly applying to suitable homes |
| *Situatiepunten* (situation points) | Documented social circumstances |
| *Startpunten* (starter points) | Young people leaving a youth contract, so they do not start from zero |

Inactivity or repeatedly refusing offered homes can cost points. Exact thresholds are set by the region and must be read from the official regional rules before the product uses them; none are encoded in `market-rules.ts`.

**Product implication**: for users on this model, the product should ideally track their own application pace this month, not just new listings. This mechanic has no equivalent in the other models.

## Urgentieverklaring (outside the six models)

Not an allocation model but it overrides all of them: an urgency status granted by the municipality gives priority regardless of other applicants' registration time. It is an external social process that happens before applying to individual listings, so it is not modelled as alert urgency; at most it is profile context.

## Private managers (product assumption)

Some private landlords and managers (`kind: manager` sources) close a listing to new applicants once enough applications have arrived. This is not a formal allocation model and not an official rule, but the practical window can be minutes rather than the nominal closing date. The product treats these sources like `direct` (the Heimstaden entry in the registry is `direct`).
