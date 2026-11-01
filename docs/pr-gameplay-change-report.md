# Gameplay PR change report

Put this in the body of any PR that changes what a player sees, chooses, or is told (S6/S9). Keep each
section to a few lines. Walk the [playability checklist](playability-checklist.md) first and cite the
lines that apply.

```markdown
## Problem
What the player experienced, in their terms. Link the issue or playtest report.

## Change
What now happens instead. The player-visible behaviour, not the file list.

## Decision impact
Which choices get easier, harder, or newly possible. Name any option that gets better or worse
everywhere (the dominance check).

## Trade-offs
What was given up, and the alternative not taken. Name any earlier merged PR whose behaviour this
alters (settled-PR rule).

## Validation
Tests added or run, with counts; sweep or play-sim evidence when a metric moved; the human check
(device, scenario, seed).

## Remaining uncertainty
What this does not prove, and the follow-up issue if any.
```

Maintainer sign-off is needed for changes to the charter, vision contract, or diagram; a gameplay PR
does not carry those.
