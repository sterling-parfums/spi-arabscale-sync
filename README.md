# Arab Scale Sync

This repository is responsible for syncing and pushing reservation documents that are created in SAP as a result of replenishment orders from production to the Arab scale measuring and printing system in the warehouse.

It is an express server written in typescript that triggers the sync on an http request.

## MSSQL configuration

The database connection helper lives in `src/utils/db.ts` and reads its config from environment variables.

Required variables:

- `BACKOFFICE_SECRET`
- `MSSQL_SERVER`
- `MSSQL_DATABASE`
- `MSSQL_USER`
- `MSSQL_PASSWORD`

Optional variables:

- `MSSQL_PORT` defaults to `1433`
- `MSSQL_ENCRYPT` defaults to `1`
- `MSSQL_TRUST_SERVER_CERTIFICATE` defaults to `0`
- `MSSQL_POOL_MAX` defaults to `10`
- `MSSQL_POOL_MIN` defaults to `0`
- `MSSQL_POOL_IDLE_TIMEOUT_MS` defaults to `30000`

## API

- `GET /` serves a single-page backoffice UI for searching and scheduling job headers
- `POST /api/sync` requires the `x-sync-secret` header
- `POST /api/sync/:reservationId` requires the `x-sync-secret` header
- `GET /api/backoffice/job-header/:jobNo` requires the `x-backoffice-secret` header and returns the matching `JOB_HEADER` row
- `PATCH /api/backoffice/job-header/:jobNo/schedule` requires the `x-backoffice-secret` header, updates `JobStatus` to `Scheduled`, and returns the updated row
