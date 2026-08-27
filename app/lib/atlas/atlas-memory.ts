import { promises as fs } from "fs";
import path from "path";

export type AtlasMemory = {
  version: 1;
  updated_at: string;
  successful_patterns: string[];
  failed_patterns: string[];
  decisions: Array<{
    date: string;
    decision: string;
    reason: string;
  }>;
  review_lessons: Array<{
    date: string;
    score?: number;
    lesson: string;
  }>;
};

const MEMORY_PATH = path.join(process.cwd(), ".atlas", "state", "editorial-memory.json");
const MAX_ITEMS = 100;

const EMPTY_MEMORY: AtlasMemory = {
  version: 1,
  updated_at: new Date(0).toISOString(),
  successful_patterns: [],
  failed_patterns: [],
  decisions: [],
  review_lessons: [],
};

async function ensureDirectory() {
  await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
}

export async function readAtlasMemory(): Promise<AtlasMemory> {
  try {
    const raw = await fs.readFile(MEMORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...EMPTY_MEMORY,
      ...parsed,
      successful_patterns: Array.isArray(parsed.successful_patterns) ? parsed.successful_patterns : [],
      failed_patterns: Array.isArray(parsed.failed_patterns) ? parsed.failed_patterns : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      review_lessons: Array.isArray(parsed.review_lessons) ? parsed.review_lessons : [],
    };
  } catch {
    return { ...EMPTY_MEMORY, updated_at: new Date().toISOString() };
  }
}

export async function writeAtlasMemory(memory: AtlasMemory) {
  await ensureDirectory();
  const next: AtlasMemory = {
    ...memory,
    updated_at: new Date().toISOString(),
    successful_patterns: memory.successful_patterns.slice(-MAX_ITEMS),
    failed_patterns: memory.failed_patterns.slice(-MAX_ITEMS),
    decisions: memory.decisions.slice(-MAX_ITEMS),
    review_lessons: memory.review_lessons.slice(-MAX_ITEMS),
  };

  const tempPath = `${MEMORY_PATH}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tempPath, MEMORY_PATH);
  return next;
}

export async function recordAtlasReview(review: {
  score?: number;
  strengths?: string[];
  issues?: Array<{ severity?: string; problem?: string; fix?: string }>;
}) {
  const memory = await readAtlasMemory();
  const now = new Date().toISOString();

  for (const strength of review.strengths || []) {
    const value = String(strength).trim();
    if (value && !memory.successful_patterns.includes(value)) memory.successful_patterns.push(value);
  }

  for (const issue of review.issues || []) {
    const value = String(issue.problem || issue.fix || "").trim();
    if (value && !memory.failed_patterns.includes(value)) memory.failed_patterns.push(value);
  }

  if (review.score !== undefined || (review.issues || []).length) {
    memory.review_lessons.push({
      date: now,
      score: Number.isFinite(Number(review.score)) ? Number(review.score) : undefined,
      lesson: [
        `Review score: ${review.score ?? "unknown"}`,
        ...(review.issues || []).slice(0, 5).map((x) => `${x.severity || "ISSUE"}: ${x.problem || x.fix || ""}`),
      ].join(" | "),
    });
  }

  return writeAtlasMemory(memory);
}

export function memoryForPrompt(memory: AtlasMemory) {
  return JSON.stringify({
    successful_patterns: memory.successful_patterns.slice(-30),
    failed_patterns: memory.failed_patterns.slice(-30),
    decisions: memory.decisions.slice(-20),
    review_lessons: memory.review_lessons.slice(-20),
  }, null, 2);
}
