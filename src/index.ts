import "dotenv/config";
import express from "express";
import {
  type SAPReservationDocument,
  getReservations,
} from "./utils/reservations";
import { buildPayload } from "./utils/payload";

const app = express();

async function scheduleJob(
  reservations: SAPReservationDocument[],
): Promise<Response | null> {
  const scaleApiUrl = process.env.SCALE_API_URL;

  if (!scaleApiUrl) {
    throw new Error("SCALE_API_URL is not defined");
  }

  const payload = await buildPayload(reservations);

  if (payload.JOB_LIST.length === 0) {
    return null;
  }

  const fetch = (...args: any[]): any => (
    console.log("Fetching Scale API:", args[0]),
    {
      ok: true,
      json: () => ({
        Success: true,
      }),
    }
  );
  return fetch(scaleApiUrl, { method: "POST", body: JSON.stringify(payload) });
}

app.get("/", (_, res) => res.send(new Date()));

app.post("/api/sync", async (req, res) => {
  const secret = req.headers["x-sync-secret"];
  if (!secret || secret !== process.env.SYNC_SECRET) {
    res.status(403).send("Forbidden");
    return;
  }

  const reservations = await getReservations();
  const response = await scheduleJob(reservations);

  if (response === null) {
    res.status(200).send("No new jobs to schedule");
    return;
  }

  if (!response.ok) {
    res.status(500).send("Failed to schedule job");
    return;
  }

  const body = await response.json();

  if (body.Success) {
    res.status(200).send();
    return;
  }

  res.status(500).send();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
