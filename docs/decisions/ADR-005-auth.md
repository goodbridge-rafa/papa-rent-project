# ADR-005 · Authentication and persistent session

**Decision.** Better Auth embedded in the API (its own tables in Postgres): e-mail + password, Sign in with Apple and Google (Apple requires Sign in with Apple when social login is offered). In the app the session lives in SecureStore: users never retype their password unless they log out or reinstall. Optional biometric lock (Face ID / fingerprint). Date of birth at sign-up (16+; youth, senior and student labels depend on it).

**Consequences.** Zero cost; no auth-provider dependency; account export and deletion are our own endpoints (GDPR). Implemented in `apps/api/src/auth.ts`; the biometric lock is not implemented yet.
