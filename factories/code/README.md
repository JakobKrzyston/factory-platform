# Factory: code

The first factory. Turns a `factory:ready` issue on this repository into a reviewed pull request.

Until TL-17 moves the first working factory into this layout, these directories hold only their READMEs. The layout follows Warp's convention: a resource's name is its path, one agent is the foreman, `skills/` at this level is shared by every agent here.

```
factory.yaml      name, repositories, defaults (model, harness), which agent is the foreman
agents/<role>/    agent.md: prompt, model, allowed tools; skills/ for that role only
triggers/<name>/  what starts a run (label added, PR opened, schedule) and which agent it calls
scorers/<name>/   scorer.md: how a benchmark result is graded
skills/           shared by every agent in this factory
```
