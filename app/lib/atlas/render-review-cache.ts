import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const CACHE_ROOT = path.join(os.tmpdir(), "atlas-render-review-cache");
const TTL_MS = 30 * 60 * 1000;

export async function ensureReviewCache() {
  await fs.mkdir(CACHE_ROOT, { recursive: true });
}

export function reviewPath(id: string) {
  if (!/^[a-f0-9-]{16,80}$/i.test(id)) {
    throw new Error("Invalid ATLAS review id.");
  }
  return path.join(CACHE_ROOT, `${id}.mp4`);
}

export async function persistRenderedVideo(sourcePath: string) {
  await ensureReviewCache();
  const id = crypto.randomUUID();
  const destination = reviewPath(id);
  await fs.copyFile(sourcePath, destination);
  await cleanupOldReviewFiles();
  return id;
}

export async function cleanupOldReviewFiles() {
  await ensureReviewCache();
  const now = Date.now();
  const entries = await fs.readdir(CACHE_ROOT, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".mp4"))
      .map(async (entry) => {
        const file = path.join(CACHE_ROOT, entry.name);
        try {
          const stat = await fs.stat(file);
          if (now - stat.mtimeMs > TTL_MS) await fs.rm(file, { force: true });
        } catch {}
      })
  );
}

export async function readReviewVideo(id: string) {
  await cleanupOldReviewFiles();
  const file = reviewPath(id);
  await fs.access(file);
  return file;
}

export async function consumeReviewVideo(id: string) {
  await cleanupOldReviewFiles();
  const file = reviewPath(id);
  await fs.access(file);
  return file;
}

export async function deleteReviewVideo(id: string) {
  try {
    await fs.rm(reviewPath(id), { force: true });
  } catch {}
}
