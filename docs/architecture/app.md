# App (universal Expo)

`apps/mobile` · Expo SDK 57, Expo Router (`src/app` directory), React Native 0.86, React 19.2, TypeScript 6.0. One codebase for iOS, Android and web (`web.output: static`).

## Structure
```
src/app/_layout.tsx          fonts, i18n, React Query, Stack.Protected by session, notification routing (native)
src/app/(auth)/              welcome · sign-up (name, e-mail, password, date of birth, consent) · sign-in
src/app/(tabs)/              index (feed) · radars · inbox · profile
src/app/(legal)/             terms · privacy · disclaimer · bot page (rendered natively from generated content)
src/app/radar/new|[id]       3-step Radar wizard (RadarForm)
src/app/listing/[id]         detail + "Reageren op {portaal}" (in-app browser)
src/app/push-prompt          notification pre-prompt (S-08)
src/app/forgot-password · reset-password · verify-email
src/components/              Text, Button, TextField, Chip, Badge, Fit, MapThumb, ListingCard, MunicipalityPicker, RadarForm, EmptyState, Screen, DemoBanner
src/lib/                     theme (tokens), i18n (NL/EN), config (env), auth-client (Better Auth + SecureStore), api (fetch with cookie), queries (React Query), format, store (local prefs), notifications, legal, demo
```

## Decisions
- **Persistent session**: `@better-auth/expo` keeps the cookie in SecureStore; on the web, regular cookies with `credentials: include`. Users never retype their password.
- **No photos from sources** (source policy): the card shows a map with a PDOK tile (BRT achtergrondkaart, CC-BY Kadaster) and a pin; the real photo is on the portal, one tap away.
- **Areas**: official list of the 342 municipalities with centroids (`@papa/core/shared` → `MUNICIPALITIES`, PDOK). A radar accepts municipalities and/or provinces, or a radius around a point.
- **Client-side thresholds** come from `@papa/core/shared` (`getRule`), never hardcoded in the UI.
- **Local preferences** (language, "already applied", "already registered on the portal") stay on the device only (zustand + AsyncStorage). None of this goes to the server.
- **Push**: Expo Notifications; the token is registered at `/v1/devices` after permission. Without a configured EAS project ID the registration is skipped with a warning. The web has no push: it relies on e-mail + inbox.
- **`@papa/core/shared`**: an entry point without Node APIs (fs/crypto) for the Metro bundle. `@papa/core` (the full index) is for the API and engine only.
- **Demo mode** (`EXPO_PUBLIC_DEMO=1`): fictional data, every write refused behind a permanent banner.

## Environment variables (build)
`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL`, `EXPO_PUBLIC_SOCIAL` (`apple,google` once credentials exist), `EXPO_PUBLIC_EAS_PROJECT_ID`, `EXPO_PUBLIC_DEMO`.

## Commands
`pnpm --filter @papa/mobile start` · `… export:web` (static `dist/` for Cloudflare Pages) · `… typecheck`.

## Open
Brand icon and splash · optional Face ID / biometric lock · end-to-end UI tests · EAS project and store builds (`app.json` still carries `REPLACE_ME` placeholders).
