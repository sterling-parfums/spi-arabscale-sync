import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

const timestampFilename = "last-sync.txt";

export async function getLastSyncTime(): Promise<Date> {
  if (!existsSync(timestampFilename)) {
    const date = new Date(0);
    await writeFile(timestampFilename, date.toISOString());
    return date;
  }

  const contents = await readFile(timestampFilename, { encoding: "utf-8" });
  return new Date(contents.trim());
}

export async function updateLastSyncTime(): Promise<Date> {
  const now = new Date();
  await writeFile(timestampFilename, now.toISOString());

  return now;
}
