/*
 * ATLAS ACTUAL BEST-CUT EVALUATOR
 *
 * Purpose:
 *   Evaluate complete edit candidates by rendering the actual MP4 and sending
 *   the server-side render token to /api/review-render.
 *
 * This is intentionally orchestration-only:
 *   Candidate timeline -> real Remotion render -> real perceptual review -> score
 *
 * It never chooses an edit from metadata alone and never mutates the candidates.
 */

export type AtlasActualBestCutCandidate = {
  id: string;
  timeline: any;
  label?: string;
};

export type AtlasActualBestCutInput = {
  candidates: AtlasActualBestCutCandidate[];
  files: File[];
  creativeBrief?: unknown;
  masterPlan?: unknown;
  captions?: unknown[];
  voiceFile?: File | null;
  musicFile?: File | null;
  businessProfile?: unknown;
  runId?: string | null;
  withMusic?: boolean;
  withCaptions?: boolean;
};

export type AtlasActualBestCutResult = {
  candidateId: string;
  label: string;
  reviewId: string | null;
  score: number;
  review: any;
  blob: Blob;
  url: string;
};

export type AtlasActualBestCutBatchResult = {
  best: AtlasActualBestCutResult | null;
  results: AtlasActualBestCutResult[];
  failures: Array<{
    candidateId: string;
    label: string;
    error: string;
  }>;
};

function finiteScore(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function appendJson(form: FormData, key: string, value: unknown): void {
  if (value == null) return;
  form.append(key, JSON.stringify(value));
}

function extractReviewId(response: Response): string | null {
  return (
    response.headers.get("X-Atlas-Review-Id") ||
    response.headers.get("x-atlas-review-id") ||
    null
  );
}

async function parseJsonResponse(response: Response): Promise<any> {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function renderCandidate(
  candidate: AtlasActualBestCutCandidate,
  input: AtlasActualBestCutInput,
): Promise<{ blob: Blob; reviewId: string | null }> {
  const form = new FormData();

  for (const file of input.files) {
    form.append("files", file, file.name);
  }

  // The renderer accepts the executable timeline and its compatibility payload.
  form.append("editTimeline", JSON.stringify(candidate.timeline));
  appendJson(form, "masterPlan", input.masterPlan || {});
  appendJson(form, "creativeBrief", input.creativeBrief || {});
  appendJson(form, "captions", input.captions || []);
  appendJson(form, "businessProfile", input.businessProfile);
  if (input.runId) form.append("runId", input.runId);
  form.append("withMusic", String(input.withMusic !== false));
  form.append("withCaptions", String(input.withCaptions !== false));

  if (input.voiceFile && input.voiceFile.size > 0) {
    form.append("voice", input.voiceFile, input.voiceFile.name);
  }

  if (input.musicFile && input.musicFile.size > 0) {
    form.append("music", input.musicFile, input.musicFile.name);
  }

  const response = await fetch("/api/render-remotion", {
    method: "POST",
    body: form,
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await parseJsonResponse(response);
    throw new Error(
      payload?.error ||
        `Candidate render failed with HTTP ${response.status}.`,
    );
  }

  const blob = await response.blob();
  return { blob, reviewId: extractReviewId(response) };
}

async function reviewRenderedCandidate(
  candidate: AtlasActualBestCutCandidate,
  render: { blob: Blob; reviewId: string | null },
  input: AtlasActualBestCutInput,
  iteration = 1,
): Promise<any> {
  if (!render.reviewId) {
    throw new Error("Renderer returned no X-Atlas-Review-Id token.");
  }

  const form = new FormData();
  form.append("reviewId", render.reviewId);
  appendJson(form, "creativeBrief", input.creativeBrief || {});
  appendJson(form, "masterPlan", input.masterPlan || {});
  form.append("iteration", String(iteration));
  form.append("bestScore", "-1");
  appendJson(form, "editTimeline", candidate.timeline || {});
  form.append("candidateId", candidate.id);
  form.append("candidateLabel", candidate.label || candidate.id);
  if (input.runId) form.append("runId", input.runId);

  const response = await fetch("/api/review-render", {
    method: "POST",
    body: form,
    credentials: "same-origin",
    cache: "no-store",
  });

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      payload?.error || `Candidate review failed with HTTP ${response.status}.`,
    );
  }

  return payload;
}

/**
 * Render + perceptually review every candidate and keep the best actual result.
 * Candidates are evaluated sequentially to avoid saturating the local renderer.
 */
export async function evaluateActualBestCut(
  input: AtlasActualBestCutInput,
): Promise<AtlasActualBestCutBatchResult> {
  const results: AtlasActualBestCutResult[] = [];
  const failures: AtlasActualBestCutBatchResult["failures"] = [];

  let best: AtlasActualBestCutResult | null = null;

  for (const candidate of input.candidates) {
    const label = candidate.label || candidate.id;

    try {
      console.log(
        `[ATLAS ACTUAL BEST-CUT] RENDERING candidate=${candidate.id} label=${label}`,
      );

      const rendered = await renderCandidate(candidate, input);
      const review = await reviewRenderedCandidate(candidate, rendered, input);
      const score = finiteScore(review?.overall_score);
      const url = URL.createObjectURL(rendered.blob);

      const evaluated: AtlasActualBestCutResult = {
        candidateId: candidate.id,
        label,
        reviewId: rendered.reviewId,
        score,
        review,
        blob: rendered.blob,
        url,
      };

      results.push(evaluated);

      console.log(
        `[ATLAS ACTUAL BEST-CUT] REVIEWED candidate=${candidate.id} score=${score}/100`,
      );

      if (!best || score > best.score) {
        if (best?.url) URL.revokeObjectURL(best.url);
        best = evaluated;
        console.log(
          `[ATLAS ACTUAL BEST-CUT] NEW BEST candidate=${candidate.id} score=${score}/100`,
        );
      }
    } catch (error: any) {
      const message = error?.message || String(error);
      failures.push({
        candidateId: candidate.id,
        label,
        error: message,
      });

      console.warn(
        `[ATLAS ACTUAL BEST-CUT] candidate failed=${candidate.id} | ${message}`,
      );
    }
  }

  return { best, results, failures };
}
