import type { MasterEditPlan, SourceAsset } from "./atlas-edit-contract";

export type EditValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  beatId?: string;
};

export function validateEditPlan(
  plan: MasterEditPlan,
  sources: SourceAsset[],
): EditValidationIssue[] {
  const issues: EditValidationIssue[] = [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const byFilename = new Map(sources.map((s) => [s.filename, s]));
  const seenWindows = new Set<string>();

  if (!plan.beats.length) {
    issues.push({ severity: "error", code: "NO_BEATS", message: "Edit plan contains no beats." });
    return issues;
  }

  if (plan.beats.length > 1) {
    for (let i = 1; i < plan.beats.length; i++) {
      if (plan.beats[i].order <= plan.beats[i - 1].order) {
        issues.push({ severity: "error", code: "ORDER", message: "Beat order is not strictly increasing.", beatId: plan.beats[i].id });
      }
    }
  }

  let total = 0;
  for (const beat of plan.beats) {
    const source = byId.get(beat.sourceId) ?? byFilename.get(beat.sourceFilename);

    if (!source) {
      issues.push({ severity: "error", code: "MISSING_SOURCE", message: `Source does not exist: ${beat.sourceFilename}`, beatId: beat.id });
      continue;
    }

    if (!(beat.end > beat.start)) {
      issues.push({ severity: "error", code: "INVALID_RANGE", message: "Beat end must be greater than start.", beatId: beat.id });
      continue;
    }

    if (beat.start < 0 || beat.end > source.duration + 0.05) {
      issues.push({ severity: "error", code: "OUT_OF_RANGE", message: `Beat ${beat.start.toFixed(2)}-${beat.end.toFixed(2)} exceeds source duration ${source.duration.toFixed(2)}s.`, beatId: beat.id });
    }

    if (beat.zoom < 1 || beat.zoom > 1.18) {
      issues.push({ severity: "error", code: "ZOOM", message: "Zoom must be between 1.0 and 1.18.", beatId: beat.id });
    }

    const windowKey = `${source.id}:${beat.start.toFixed(3)}:${beat.end.toFixed(3)}`;
    if (seenWindows.has(windowKey)) {
      issues.push({ severity: "warning", code: "DUPLICATE_WINDOW", message: "Exact source window is repeated.", beatId: beat.id });
    }
    seenWindows.add(windowKey);
    total += beat.end - beat.start;
  }

  const drift = Math.abs(total - plan.targetDurationSeconds);
  if (drift > 1.5) {
    issues.push({ severity: "warning", code: "DURATION_DRIFT", message: `Visual duration ${total.toFixed(2)}s differs from target ${plan.targetDurationSeconds.toFixed(2)}s.` });
  }

  if (plan.voice.mode !== "NONE" && !plan.voice.script.trim()) {
    issues.push({ severity: "error", code: "EMPTY_VOICE", message: "Voice mode is enabled but the script is empty." });
  }

  return issues;
}
