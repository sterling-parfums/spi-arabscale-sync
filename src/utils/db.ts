import sql, { type config as SQLConfig, type ConnectionPool } from "mssql";

const REQUIRED_DB_ENVS = [
  "MSSQL_SERVER",
  "MSSQL_DATABASE",
  "MSSQL_USER",
  "MSSQL_PASSWORD",
] as const;

let poolPromise: Promise<ConnectionPool> | null = null;

function requireEnv(name: (typeof REQUIRED_DB_ENVS)[number]): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required MSSQL environment variable: ${name}`);
  }

  return value;
}

function getDbConfig(): SQLConfig {
  const port = process.env.MSSQL_PORT
    ? Number.parseInt(process.env.MSSQL_PORT, 10)
    : 1433;

  if (Number.isNaN(port)) {
    throw new Error("Invalid MSSQL_PORT environment variable");
  }

  return {
    server: requireEnv("MSSQL_SERVER"),
    database: requireEnv("MSSQL_DATABASE"),
    user: requireEnv("MSSQL_USER"),
    password: requireEnv("MSSQL_PASSWORD"),
    port,
    options: {
      encrypt: process.env.MSSQL_ENCRYPT !== "0",
      trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE === "1",
    },
    pool: {
      max: process.env.MSSQL_POOL_MAX
        ? Number.parseInt(process.env.MSSQL_POOL_MAX, 10)
        : 10,
      min: process.env.MSSQL_POOL_MIN
        ? Number.parseInt(process.env.MSSQL_POOL_MIN, 10)
        : 0,
      idleTimeoutMillis: process.env.MSSQL_POOL_IDLE_TIMEOUT_MS
        ? Number.parseInt(process.env.MSSQL_POOL_IDLE_TIMEOUT_MS, 10)
        : 30000,
    },
  };
}

export async function getDbConnection(): Promise<ConnectionPool> {
  if (!poolPromise) {
    poolPromise = sql.connect(getDbConfig()).catch((error) => {
      poolPromise = null;
      throw error;
    });
  }

  return poolPromise;
}

export async function closeDbConnection(): Promise<void> {
  if (!poolPromise) {
    return;
  }

  const pool = await poolPromise;
  poolPromise = null;
  await pool.close();
}

export { sql };
