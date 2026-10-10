# Contributing

Thanks for helping improve Stack Accord.

## Set up

Stack Accord requires Node.js 20 or newer and pnpm 11.

```bash
corepack enable
pnpm install
pnpm check
pnpm test
pnpm build
```

## Proposing a rule

A useful Stack Accord rule should:

1. Identify a concrete deployment failure or operational risk.
2. Explain the relationship between the relevant layers.
3. Provide evidence locations and an actionable remediation.
4. Avoid an error-level finding when the evidence is ambiguous.
5. Include a broken fixture, a healthy fixture, and an automated test.

Open an issue before implementing a large parser or platform integration so the model can be discussed first.

## Pull requests

- Keep changes focused.
- Add or update documentation for user-visible behavior.
- Ensure `pnpm check`, `pnpm test`, and `pnpm build` pass.
- Do not include credentials, customer configurations, or private incident data in fixtures.
