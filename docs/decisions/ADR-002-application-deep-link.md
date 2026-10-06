# ADR-002 · Applying via deep link (the Skyscanner model)

**Context.** The product must be as simple as possible: the user gets the alert and reaches the application point as fast as possible. Document uploads in our app would bring sensitive data (GDPR/AVG), friction and liability.

**Decision.** One tap on the alert → the listing screen in the app → a "Reageren op [portal]" button opens the in-app browser directly on the source's application page (the detail URL with the respond button), where the user is already logged in. No uploads, no portal credentials. An optional eligibility profile in bands (income, household, age, doorstromer, key profession) is used only for the "past bij jou" badge and to hide what does not fit. Automatic applications: out of the MVP; to be reconsidered per source only with a formal agreement.

**Consequences.** No sensitive documents stored; onboarding under 90 seconds; alert speed is the product. For each listing the app must say whether prior registration on the portal is required (and what it costs), because that is what slows the user down at the critical moment.
