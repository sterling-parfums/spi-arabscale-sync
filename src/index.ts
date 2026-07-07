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
import { logger } from "./utils/logger";

const REQUIRED_ENVS = ["SYNC_SECRET", "BACKOFFICE_SECRET", "SCALE_API_URL"];
for (const env of REQUIRED_ENVS) {
  if (!process.env[env]) {
    logger.error(`Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

const app = express();
const HOME_PAGE_PATH = path.join(process.cwd(), "src/html/index.html");
const STATIC_ASSETS_PATH = path.join(process.cwd(), "src/html");

async function getBackofficeJob(jobNo: string) {
  const db = await getDbConnection();
  const headerResult = await db.request().input("jobNo", sql.VarChar, jobNo)
    .query(`
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

  if (headerResult.recordset.length === 0) {
    return null;
  }

  const header = headerResult.recordset[0];
  const ingredientsResult = await db
    .request()
    .input("hdrId", sql.Int, header.Id)
    .query(`
      SELECT
        IngredientCode,
        IngredientName,
        TargetWt,
        ScaleNo
      FROM dbo.JOB_DETAILS
      WHERE HdrId = @hdrId
        AND [Type] = 0
      ORDER BY SeqNo, Id;
    `);

  return {
    header,
    ingredients: ingredientsResult.recordset,
  };
}

async function updateBackofficeJobStatus(jobNo: string, status: string) {
  const currentJob = await getBackofficeJob(jobNo);
  if (!currentJob) {
    return null;
  }

  const currentStatus = String(currentJob.header.JobStatus || "").trim().toLowerCase();
  const nextStatus = status.trim().toLowerCase();
  const isValidTransition =
    (currentStatus === "pending" && nextStatus === "scheduled") ||
    (currentStatus === "scheduled" && nextStatus === "pending");

  if (!isValidTransition) {
    return currentJob;
  }

  const db = await getDbConnection();
  await db.request().input("jobNo", sql.VarChar, jobNo).query(`
      UPDATE dbo.JOB_HEADER
      SET
        JobStatus = '${status}',
        ModifiedBy = 'SPI Backoffice',
        ModifiedOn = GETDATE()
      WHERE JobNo = @jobNo;
    `);

  return getBackofficeJob(jobNo);
}

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
    {
      stream: {
        write: (message) => logger.info(message.trimEnd()),
      },
    },
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

    logger.info(`Fetching JOB_HEADER for JobNo ${jobNo}...`);

    const job = await getBackofficeJob(jobNo);
    if (!job) {
      return res.status(404).send("JOB_HEADER not found");
    }

    logger.info(`Fetched JOB_HEADER for JobNo ${jobNo}`);
    return res.status(200).json(job);
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

    logger.info(`Updating JOB_HEADER status to Scheduled for JobNo ${jobNo}...`);

    const job = await updateBackofficeJobStatus(jobNo, "Scheduled");
    if (!job) {
      return res.status(404).send("JOB_HEADER not found");
    }
    if (String(job.header.JobStatus || "").trim().toLowerCase() !== "scheduled") {
      return res.status(409).send("Only Pending jobs can be scheduled");
    }

    logger.info(`Updated JOB_HEADER status for JobNo ${jobNo}`);
    return res.status(200).json(job);
  },
);

app.patch(
  "/api/backoffice/job-header/:jobNo/unschedule",
  requireSecret("x-backoffice-secret", process.env.BACKOFFICE_SECRET!),
  async (req, res) => {
    const jobNo = req.params.jobNo?.trim();
    if (!jobNo) {
      return res.status(400).send("JobNo is required");
    }

    logger.info(`Updating JOB_HEADER status to Pending for JobNo ${jobNo}...`);

    const job = await updateBackofficeJobStatus(jobNo, "Pending");
    if (!job) {
      return res.status(404).send("JOB_HEADER not found");
    }
    if (String(job.header.JobStatus || "").trim().toLowerCase() !== "pending") {
      return res.status(409).send("Only Scheduled jobs can be unscheduled");
    }

    logger.info(`Updated JOB_HEADER status for JobNo ${jobNo}`);
    return res.status(200).json(job);
  },
);

app.post(
  "/api/sync",
  requireSecret("x-sync-secret", process.env.SYNC_SECRET!),
  async (_, res) => {
    logger.info("Fetching reservations from SAP...");
    const reservations = await getLatestReservations();
    logger.info(`Fetched ${reservations.length} reservations from SAP`);

    if (reservations.length === 0) {
      return res.status(200).send("No new reservations to process");
    }

    logger.info("Building jobs payload...");
    const jobsPayload = await buildJobsPayload(reservations);
    logger.info(`Built jobs payload with ${jobsPayload.JOB_LIST.length} jobs`);

    if (process.env.DRY_RUN === "1") {
      return res.status(200).json(jobsPayload);
    }

    if (jobsPayload.JOB_LIST.length === 0) {
      res.status(200).send("No new jobs to schedule");
      return;
    }

    logger.info("Scheduling jobs to Scale API...");
    logger.info("Scheduling job numbers", jobsPayload.JOB_LIST.map((j) => j.JOB_NO));

    const jobsPayloads = splitPayload(jobsPayload);
    const payloadResponses = [];

    for (const payload of jobsPayloads) {
      const response = await fetch(process.env.SCALE_API_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.error(
          `Failed to schedule job(${payload.JOB_LIST[0].JOB_NO}):`,
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

    logger.info(`Fetching reservation ${reservationId} from SAP...`);
    const reservation = await getReservation(reservationId);

    if (!reservation) {
      return res.status(404).send("Reservation not found");
    }
    logger.info(`Fetched reservation ${reservationId} from SAP`);

    logger.info("Building job payload...");
    const payload = await buildJobsPayload([reservation]);
    logger.info(`Built job payload with ${payload.JOB_LIST.length} jobs`);

    if (payload.JOB_LIST.length === 0) {
      return res.status(200).send("No jobs to schedule");
    }

    if (process.env.DRY_RUN === "1") {
      return res.status(200).json(payload);
    }

    logger.info("Scheduling job to Scale API...");
    const response = await fetch(process.env.SCALE_API_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error("Failed to schedule job:", response.statusText);
      return res.status(500).json({ error: response.statusText, response });
    }
    logger.info("Successfully triggered job to Scale API");

    const body = await response.json();

    if (!body.Success) {
      logger.error("Job scheduling failed on Scale server");
      return res.status(500).json({ response: body });
    }

    logger.info("Successfully scheduled job to Scale API");
    return res.status(200).json({ response: body, jobs: payload });
  },
);

app.use(((err, _req, res, _next) => {
  logger.error("Unhandled error", err);

  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
}) as ErrorRequestHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server started at ${new Date().toLocaleString()}`);
  logger.info(`Server is running on port ${PORT}`);
});
