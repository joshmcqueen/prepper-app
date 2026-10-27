# Project guidance

- Use pnpm and TypeScript. Recommended runtime: Node 24 LTS; Node 26 is also supported.
- This is an intentionally disposable prototype database. Maintain one `server/schema.sql`; do not add migration history. Reset and reseed for incompatible schema changes.
- Keep sample data clearly identified, separate from any real household inventory. Reset/reseed must clear settings as well as inventory, photos, and reminder history. Sample recipients stay blank.
- Keep OpenAI calls and all credentials on the server; prompts belong in `prompts/`. AI output is a reviewable draft, never an automatic inventory mutation.
- Preserve totals when splitting or moving bags. Buckets are storage containers and never add quantity. Do not infer mass from packaging volume.
- Unknown values remain unknown. Human and dog calories are separate. Best-by dates are not automatic safety decisions.
- Preserve manual form input on failures and conflicts. Validate on the server and transact quantity changes.
- Use `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm test:browser` for changes affecting these behaviors. Browser tests must use their isolated data directory.
- Do not add authentication, device offline synchronization, Docker, or S3 deployment without a new request.
