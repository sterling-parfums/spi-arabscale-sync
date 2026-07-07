import "dotenv/config";
import path from "path";
import express, {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";
import { getLatestReservations, getReservation } from "./utils/reservations";
import { buildJobsPayload, splitPayload } from "./utils/payload";
import morgan from "morgan";
import { getDbConnection, sql } from "./utils/db";

const REQUIRED_ENVS = ["SYNC_SECRET", "BACKOFFICE_SECRET", "SCALE_API_URL"];
for (const env of REQUIRED_ENVS) {
  if (!process.env[env]) {
    console.error(`❌ Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

const app = express();
const HOME_PAGE_PATH = path.join(process.cwd(), "src/html/index.html");
const STATIC_ASSETS_PATH = path.join(process.cwd(), "src/html");

function requireSecret(headerName: string, expectedSecret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const secret = req.headers[headerName];
    if (!secret || secret !== expectedSecret) {
      res.status(403).send("Forbidden");
      return;
    }

    next();
  };
}

app.use(
  morgan(
    "[:date[clf]] :method :url :status :res[content-length] - :response-time ms",
  ),
);
app.use(express.static(STATIC_ASSETS_PATH));

app.get("/", (_, res) => {
  res.sendFile(HOME_PAGE_PATH);
});

app.get(
  "/api/backoffice/job-header/:jobNo",
  requireSecret("x-backoffice-secret", process.env.BACKOFFICE_SECRET!),
  async (req, res) => {
    const jobNo = req.params.jobNo?.trim();
    if (!jobNo) {
      return res.status(400).send("JobNo is required");
    }

    console.log(`⌛️ Fetching JOB_HEADER for JobNo ${jobNo}...`);

    const db = await getDbConnection();
    const result = await db.request().input("jobNo", sql.VarChar, jobNo).query(`
      SELECT
        Id,
        ScheduleDate,
        JobNo,
        ProductId,
        ProductCode,
        ProductName,
        FormulaId,
        FormulaName,
        ProdWt,
        ProdWt_G,
        FinishProdWt,
        FinishProdWt_G,
        UnitSymbol,
        Prod_Qty,
        Remarks,
        JobStatus,
        Reason
      FROM dbo.JOB_HEADER
      WHERE JobNo = @jobNo;
    `);

    if (result.recordset.length === 0) {
      return res.status(404).send("JOB_HEADER not found");
    }

    console.log(`✅ Fetched JOB_HEADER for JobNo ${jobNo}`);
    return res.status(200).json(result.recordset[0]);
  },
);

app.patch(
  "/api/backoffice/job-header/:jobNo/schedule",
  requireSecret("x-backoffice-secret", process.env.BACKOFFICE_SECRET!),
  async (req, res) => {
    const jobNo = req.params.jobNo?.trim();
    if (!jobNo) {
      return res.status(400).send("JobNo is required");
    }

    console.log(
      `⌛️ Updating JOB_HEADER status to Scheduled for JobNo ${jobNo}...`,
    );

    const db = await getDbConnection();
    const result = await db.request().input("jobNo", sql.VarChar, jobNo).query(`
      UPDATE dbo.JOB_HEADER
      SET
        JobStatus = 'Scheduled',
        ModifiedOn = GETDATE()
      WHERE JobNo = @jobNo;

      SELECT
        Id,
        ScheduleDate,
        JobNo,
        ProductId,
        ProductCode,
        ProductName,
        FormulaId,
        FormulaName,
        ProdWt,
        ProdWt_G,
        FinishProdWt,
        FinishProdWt_G,
        UnitSymbol,
        Prod_Qty,
        Remarks,
        JobStatus,
        Reason
      FROM dbo.JOB_HEADER
      WHERE JobNo = @jobNo;
    `);

    if (result.recordset.length === 0) {
      return res.status(404).send("JOB_HEADER not found");
    }

    console.log(`✅ Updated JOB_HEADER status for JobNo ${jobNo}`);
    return res.status(200).json(result.recordset[0]);
  },
);

app.post(
  "/api/sync",
  requireSecret("x-sync-secret", process.env.SYNC_SECRET!),
  async (_, res) => {
    console.log("⌛️ Fetching reservations from SAP...");
    const reservations = await getLatestReservations();
    console.log(`✅ Fetched ${reservations.length} reservations from SAP`);

    if (reservations.length === 0) {
      return res.status(200).send("No new reservations to process");
    }

    console.log("⌛️ Building jobs payload...");
    const jobsPayload = await buildJobsPayload(reservations);
    console.log(
      `✅ Built jobs payload with ${jobsPayload.JOB_LIST.length} jobs`,
    );

    if (process.env.DRY_RUN === "1") {
      return res.status(200).json(jobsPayload);
    }

    if (jobsPayload.JOB_LIST.length === 0) {
      res.status(200).send("No new jobs to schedule");
      return;
    }

    console.log("⌛️ Scheduling jobs to Scale API...");
    console.log(JSON.stringify(jobsPayload.JOB_LIST.map((j) => j.JOB_NO)));

    const jobsPayloads = splitPayload(jobsPayload);
    const payloadResponses = [];

    for (const payload of jobsPayloads) {
      const response = await fetch(process.env.SCALE_API_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(
          `❌ Failed to schedule job(${payload.JOB_LIST[0].JOB_NO}):`,
          response.statusText,
        );

        payloadResponses.push({
          job: payload.JOB_LIST[0].JOB_NO,
          status: response.status,
          error: response.statusText,
        });
        continue;
      }

      const body = await response.json();

      payloadResponses.push({
        job: payload.JOB_LIST[0].JOB_NO,
        status: response.status,
        success: body.Success,
        message: body.Message,
      });
    }

    return res.status(200).json({ responses: payloadResponses });
  },
);

app.post(
  "/api/sync/:reservationId",
  requireSecret("x-sync-secret", process.env.SYNC_SECRET!),
  async (req, res) => {
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
  },
);

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
