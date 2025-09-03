import { existsSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

export async function getLastReservationId(): Promise<string> {
  const filename = "last-reservation.txt";

  if (existsSync(filename)) {
    const contents = await readFile(filename, { encoding: "utf-8" });
    return contents.trim() || "0";
  }

  return "0";
}

export async function setLastReservationId(
  reservationId?: string,
): Promise<void> {
  const lastReservationDocumentId = reservationId ?? "0";
  writeFileSync("last-reservation.txt", lastReservationDocumentId);
}
