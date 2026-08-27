# ATLAS CANONICAL ARCHITECTURE

## Mission

ATLAS is a deterministic AI-assisted commercial video editor. AI systems make editorial decisions; execution code executes those decisions. No renderer should invent creative decisions that were not present in the canonical edit plan.

## Canonical pipeline

```text
Creative Brief
  ↓
Creative / Ideal Director
  ↓
Vision + Speech Intelligence
  ↓
Master Director
  ↓
AI Edit Director
  ↓
Canonical Executable Edit Contract
  ↓
Single Validation Boundary
  ↓
SFX / Audio Design
  ↓
Deterministic Remotion Render
  ↓
Execution Telemetry + Render Artifact
  ↓
Final Cut Review
  ↓
Targeted Revision
  ↓
Validation → Render → Review
```

## Responsibility boundaries

### Directors
Decide story, shot choice, timing, pacing, visual treatment, typography, transitions and audio intent.

### Validator
Rejects malformed or unsafe executable plans. It must not invent creative content or silently rewrite the director's intent.

### SFX Director
Converts explicit editorial audio intent into concrete SFX events/assets. It must not become a general-purpose visual editor.

### Renderer
Executes the canonical contract deterministically. It may perform technical safety normalization only when required to prevent a crash; it must not make creative substitutions.

### Reviewer
Judges the actual rendered result. It receives both visual evidence and execution metadata. A feature existing in JSON is not evidence that the feature actually appeared in the final render.

### Memory
Stores durable editorial lessons, successful patterns, failed patterns and important decisions. Memory is advisory context for Directors; it never overrides the current brief or explicit user requirements.

## Non-negotiable invariants

1. One canonical executable edit contract.
2. One authoritative validation boundary before rendering.
3. Renderer does not improvise creative edits.
4. Review is based on the actual render, not only the plan.
5. Revisions are targeted at identified root causes.
6. Every meaningful architectural change is logged.
7. Machine-specific paths and credentials do not define project behavior.
8. Legacy code may remain temporarily for migration, but it must be clearly marked and must not silently become a second canonical pipeline.

## Migration policy

The repository currently contains historical/legacy render and versioned files. They are not removed blindly. Before deletion, callers must be traced and the canonical path must be verified with a successful render. Once unused, legacy paths can be archived or removed in a dedicated cleanup commit.
