# 01: Private Throughline instance (TL-1)

## Expected

Following Throughline's `docs/DEPLOY.md` ("A private instance on your own key") would give a second deployment, separate from the public demo, that only the owner can open and whose agents run on the owner's Anthropic key. An afternoon of configuration, no code.

## Happened

- **Database:** a new Neon project, `factory-platform`, not a branch of the public one. All 13 Throughline migrations are recorded in `drizzle.__drizzle_migrations`, matching the journal on Throughline's `main`. The `factory` project was seeded from `docs/PLAN.md` as one approved import proposal: 6 outcomes, 24 requirements.
- **Deployment:** a second Vercel project, `throughline-factory`, on the same Throughline repository, production branch `release`. `PUBLIC_DEPLOYMENT` is unset, so every form works and agents use `ANTHROPIC_API_KEY`. No OpenRouter key is set, so the free demo model is never used.
- **Protection:** the first deploys went out with Vercel Authentication on its default scope, Standard Protection. That scope leaves the production domain public, and a check found `/p/factory` serving the full app to a signed-out request, with the Anthropic key behind it. Switching the scope to **All Deployments** closed it: every path, including `/api/github/webhook`, now redirects to Vercel sign-in. Protection Bypass for Automation is on for GitHub's webhook deliveries (TL-2).

The lesson: "Vercel Authentication is on" is not the same as "the site is private". Check the production URL from a signed-out client after every protection change.

## What the numbers said

| Check | Result |
| --- | --- |
| Migrations applied | 13 of 13 |
| Signed-out `GET /p/factory` | 302 to Vercel sign-in (was 200 before the scope change) |
| Model for `factory` agents | Anthropic, `ANTHROPIC_MODEL` unset, so `claude-sonnet-5-5` |
| Cost so far | Vercel Hobby and Neon Free: $0; Anthropic: nothing reconciled yet |
