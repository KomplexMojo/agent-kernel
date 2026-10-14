---
name: game-recap
description: Tell the story of an agent-kernel run that just happened. Usage /game-recap [runId].
disable-model-invocation: true
argument-hint: [runId]
---

# /game-recap

Recap a run: $ARGUMENTS

1. The run is the `runId` given, else the latest `ak_run` (or `/game-watch`) in this
   conversation. A game played only through `/game-play` has no recorded run; say so and
   offer `/game-watch` instead.
2. Call `ak_narrate {tickFrames, initialState}`: the tick frames are that run's
   `artifactPaths.tick_frames`, and the initial state is its level's
   (`ak_create`'s `artifactPaths.initial_state`). The story is in the file at its
   `artifactPaths.narrative` (a NarrativeArtifact: `story`, `summary`, `turns`, `cast`); read it.
   Add `ak_inspect {tickFrames}` for the totals.
3. Tell it as a short story in a few sentences, in order, using what the narrative and
   inspection report (who acted, what was cast, what fell, who reached the exit). Don't add
   events or numbers they don't contain.
