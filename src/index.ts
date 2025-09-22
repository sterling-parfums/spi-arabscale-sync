import "dotenv/config";
import express, {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";
import { getLatestReservations, getReservation } from "./utils/reservations";
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
    "[:date[clf]] :method :url :status :res[content-length] - :response-time ms",
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
  const reservations = await getLatestReservations();
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
  console.log(JSON.stringify(jobsPayload.JOB_LIST.map((j) => j.JOB_NO)));

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
    res.status(200).json({
      response: body,
      jobs: jobsPayload.JOB_LIST.map((j) => j.JOB_NO),
    });
    console.log("✅ Successfully scheduled jobs to Scale API");
    return;
  }

  res.status(500).json({ response: body });
});

app.post("/api/sync/:reservationId", async (req, res) => {
  const reservationId = req.params.reservationId as string;
  if (isNaN(parseInt(reservationId))) {
    return res.status(400).send("Invalid reservation ID");
  }

  console.log(`⌛️ Fetching reservation ${reservationId} from SAP...`);
  const reservation = await getReservation(reservationId);

  if (!reservation) {
    return res.status(404).send("Reservation not found");
  }
  console.log(`✅ Fetched reservation ${reservationId} from SAP`);

  console.log("⌛️ Building job payload...");
  const payload = await buildJobsPayload([reservation]);
  console.log(`✅ Built job payload with ${payload.JOB_LIST.length} jobs`);

  if (payload.JOB_LIST.length === 0) {
    return res.status(200).send("No jobs to schedule");
  }

  if (process.env.DRY_RUN === "1") {
    return res.status(200).json(payload);
  }

  console.log("⌛️ Scheduling job to Scale API...");
  const response = await fetch(process.env.SCALE_API_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error("Failed to schedule job:", response.statusText);
    return res.status(500).json({ error: response.statusText, response });
  }
  console.log("✅ Successfully triggered job to Scale API");

  const body = await response.json();

  if (!body.Success) {
    console.log("❌ Job scheduling failed on Scale server");
    return res.status(500).json({ response: body });
  }

  console.log("✅ Successfully scheduled job to Scale API");
  return res.status(200).json({ response: body, jobs: payload });
});

app.use(((err, _req, res, _next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
}) as ErrorRequestHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("⏰", new Date().toLocaleString());
  console.log(`🚀 Server is running on port ${PORT}`);
});
