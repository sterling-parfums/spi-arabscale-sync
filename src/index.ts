import "dotenv/config";
import express from "express";
import { getReservations } from "./utils/reservations";
import { buildJobsPayload } from "./utils/payload";
import morgan from "morgan";

const REQUIRED_ENVS = ["SYNC_SECRET", "SCALE_API_URL"];
for (const env of REQUIRED_ENVS) {
  if (!process.env[env]) {
    console.error(`❌ Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

const app = express();

app.use(
  morgan(
    "[:date[clf] :method :url :status :res[content-length] - :response-time ms",
  ),
);

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
  console.log("⌛️ Fetching reservations from SAP...");
  const reservations = await getReservations();
  console.log(`✅ Fetched ${reservations.length} reservations from SAP`);

  console.log("⌛️ Building jobs payload...");
  const jobsPayload = await buildJobsPayload(reservations);
  console.log(`✅ Built jobs payload with ${jobsPayload.JOB_LIST.length} jobs`);

  if (process.env.DRY_RUN === "1") {
    return res.status(200).json(jobsPayload);
  }

  if (jobsPayload.JOB_LIST.length === 0) {
    res.status(200).send("No new jobs to schedule");
    return;
  }

  console.log("⌛️ Scheduling jobs to Scale API...");
  console.log(JSON.stringify(jobsPayload, null, 2));
  const response = await fetch(process.env.SCALE_API_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(jobsPayload),
  });

  if (!response.ok) {
    console.error("Failed to schedule job:", response.statusText);
    res.status(500).json({ error: response.statusText, response });
    return;
  }

  const body = await response.json();

  if (body.Success) {
    res.status(200).json({ response: body, jobs: jobsPayload });
    console.log("✅ Successfully scheduled jobs to Scale API");
    return;
  }

  res.status(500).json({ response: body });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("⏰", new Date().toLocaleString());
  console.log(`🚀 Server is running on port ${PORT}`);
});
