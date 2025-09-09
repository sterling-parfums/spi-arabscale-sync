import "dotenv/config";
import express from "express";
import { getReservations } from "./utils/reservations";
import { buildJobsPayload } from "./utils/payload";

const REQUIRED_ENVS = ["SYNC_SECRET", "SCALE_API_URL"];
for (const env of REQUIRED_ENVS) {
  if (!process.env[env]) {
    console.error(`❌ Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

const app = express();

app.use((req, res, next) => {
  const secret = req.headers["x-sync-secret"];
  if (!secret || secret !== process.env.SYNC_SECRET) {
    res.status(403).send("Forbidden");
    return;
  }

  next();
});

app.get("/", (_, res) => res.send(new Date()));

app.post("/api/sync", async (_, res) => {
  const reservations = await getReservations();
  const jobsPayload = await buildJobsPayload(reservations);

  if (jobsPayload.JOB_LIST.length === null) {
    res.status(200).send("No new jobs to schedule");
    return;
  }

  const response = await fetch(process.env.SCALE_API_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(jobsPayload),
  });

  if (!response.ok) {
    res.status(500).send("Failed to schedule job");
    console.error("Failed to schedule job:", response.statusText);
    return;
  }

  const body = await response.json();

  if (body.Success) {
    res.status(200).json({ response: body, jobs: jobsPayload });
    return;
  }

  res.status(500).json({ response: body });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
