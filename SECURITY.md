# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/phase-breaker/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static Phase Breaker browser game, including replay and design share links, custom level input, telemetry and audit exports, local browser storage and browser rendering.

In scope:

- A cross-site scripting or HTML injection path through level text, replay data, designer input, share links, telemetry output or generated exports.
- A replay, design or seed codec flaw that bypasses validation, corrupts another game state, or executes attacker-controlled code.
- A JSON, CSV or audit export escaping flaw that makes generated output execute a formula or script when opened.
- A solver, replay verifier or level validator resource-exhaustion flaw triggered by input accepted as valid.
- A browser-storage or state-restoration flaw that crosses origins or persists attacker-controlled markup.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- The documented limits of deterministic generation and solvability checking, unless a report shows a specific validation or output integrity failure.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
