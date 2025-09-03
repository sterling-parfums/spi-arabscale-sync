import "dotenv/config";
import express from "express";
import { existsSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

const app = express();

const productNameCache: Record<string, string> = {};

async function getSAP(url: string) {
  const username = process.env.SAP_API_USERNAME;
  const password = process.env.SAP_API_PASSWORD;

  return fetch(url, {
    method: "GET",
    headers: { Authorization: `Basic ${btoa(`${username}:${password}`)}` },
  });
}

let lastReservationDocumentId: string | undefined;
async function getLastReservationId(): Promise<string> {
  if (lastReservationDocumentId) {
    return lastReservationDocumentId;
  }

  const filename = "last-reservation.txt";

  if (existsSync(filename)) {
    const contents = await readFile(filename, { encoding: "utf-8" });
    lastReservationDocumentId = contents.trim() || "0";
  } else {
    lastReservationDocumentId = "0";
  }

  return lastReservationDocumentId;
}

async function setLastReservationId(reservationId?: string): Promise<void> {
  console.log("Setting last reservation ID:", reservationId);

  lastReservationDocumentId = reservationId ?? "0";
  writeFileSync("last-reservation.txt", lastReservationDocumentId);
}

type SAPReservationDocument = {
  Reservation: string;
  OrderID: string;
  _ReservationDocumentItem: Array<{
    Product: string;
    ResvnItmRequiredQtyInBaseUnit: number;
    BaseUnit: string;
  }>;
};
async function getReservations(): Promise<SAPReservationDocument[]> {
  console.log("Getting reservations from SAP");

  const lastReservation = await getLastReservationId();

  console.log("Last reservation ID:", lastReservation);

  const baseUrl = `${process.env.SAP_API_URL}/sap/opu/odata4/sap/api_reservation_document/srvd_a2x/sap/apireservationdocument/0001`;
  let nextUrl =
    `ReservationDocument` +
    `?$filter=OrderID ne null and Reservation gt '${lastReservation}'` +
    "&$expand=_ReservationDocumentItem($select=Product,ResvnItmRequiredQtyInBaseUnit,BaseUnit)" +
    "&$select=Reservation,OrderID";

  const docs: SAPReservationDocument[] = [];

  while (nextUrl) {
    const response = await getSAP(baseUrl + "/" + nextUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch reservations: ${response.statusText}`);
    }

    const body = await response.json();

    console.log(
      `Fetched ${body.value.length} reservations, next link: ${body["@odata.nextLink"]}`,
    );

    if (!body.value || body.value.length === 0) break;

    docs.push(...body.value);

    nextUrl = body["@odata.nextLink"];
  }

  console.log(`Total reservations fetched: ${docs.length}`);

  if (docs.length === 0) return docs;

  docs.sort((a, b) => Number(a.Reservation) - Number(b.Reservation));
  const lastDoc = docs[docs.length - 1];
  await setLastReservationId(lastDoc?.Reservation);

  return docs.slice(0, 1);
}

type SAPProduct = {
  d: {
    Product: string;
    to_Description: {
      ProductDescription: string;
    };
  };
};
async function getProductName(id: string): Promise<string | null> {
  console.log("Getting product name for ID:", id);

  if (productNameCache[id]) {
    return productNameCache[id];
  }

  const baseUrl = process.env.SAP_API_URL;
  const url =
    `${baseUrl}/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product` +
    `('${id}')` +
    `?$expand=to_Description` +
    `&$select=to_Description/ProductDescription`;

  const response = await getSAP(url);

  if (!response.ok) {
    return null;
  }

  const product = (await response.json()) as SAPProduct;
  productNameCache[id] = product.d.to_Description.ProductDescription;

  return productNameCache[id];
}

type SAPProcessOrder = {
  ProcessOrder: string;
  Material: string;
  TotalQuantity: string;
};
async function getProcessOrder(id: string): Promise<SAPProcessOrder | null> {
  console.log("Getting process order for ID:", id);

  const baseUrl = process.env.SAP_API_URL;
  const url =
    `${baseUrl}/sap/opu/odata/sap/API_PROCESS_ORDER_2_SRV/A_ProcessOrder_2` +
    `('${id}')` +
    `?$select=ProcessOrder,Material`;

  const response = await getSAP(url);

  if (!response.ok) {
    console.error(
      `Failed to fetch process order ${id}: ${response.statusText}`,
    );
    return null;
  }

  const order = (await response.json()) as SAPProcessOrder;

  return order;
}

type ScalePayload = {
  JOB_LIST: Array<{
    JOB_NO: string;
    PRODUCT_CODE: string;
    PRODUCT_NAME: string;
    BATCH_NO: string;
    BATCH_WEIGHT: number;
    SCHEDULE_DATE: string;
    INGREDIENT_LIST: Array<{
      INGREDIENT_CODE: string;
      INGREDIENT_NAME: string;
      INGREDIENT_LOT: Array<{
        LOT_NO: string;
        EXPIRY_DATE: string;
        MANUFACTURER_NAME: string;
        TARGET_WEIGHT: number;
        UNIT: string;
      }>;
    }>;
  }>;
};
async function buildPayload(
  reservations: SAPReservationDocument[],
): Promise<ScalePayload> {
  console.log("Building payload for scale API");

  const payload: ScalePayload = { JOB_LIST: [] };
  const jobList = payload.JOB_LIST;
  const NA = "N/A" as const;
  const now = new Date();

  for (const reservation of reservations) {
    console.log("Processing reservation:", reservation.Reservation);

    const processOrder = await getProcessOrder(reservation.OrderID);
    if (!processOrder) continue;

    const materialName = await getProductName(processOrder.Material);

    const job: ScalePayload["JOB_LIST"][0] = {
      JOB_NO: reservation.Reservation,
      PRODUCT_CODE: processOrder.Material,
      PRODUCT_NAME: materialName ?? "",
      BATCH_NO: NA,
      BATCH_WEIGHT: reservation._ReservationDocumentItem.reduce(
        (sum, item) => sum + item.ResvnItmRequiredQtyInBaseUnit,
        0,
      ),
      SCHEDULE_DATE: now.toISOString(),
      INGREDIENT_LIST: [],
    };

    const ingredientList = job.INGREDIENT_LIST;
    for (const item of reservation._ReservationDocumentItem) {
      console.log("Processing reservation item:", item.Product);

      const productName = await getProductName(item.Product);
      const ingredient: ScalePayload["JOB_LIST"][0]["INGREDIENT_LIST"][0] = {
        INGREDIENT_CODE: item.Product,
        INGREDIENT_NAME: productName ?? "",
        INGREDIENT_LOT: [
          {
            LOT_NO: NA,
            EXPIRY_DATE: NA,
            MANUFACTURER_NAME: NA,
            TARGET_WEIGHT: item.ResvnItmRequiredQtyInBaseUnit,
            UNIT: item.BaseUnit,
          },
        ],
      };

      ingredientList.push(ingredient);
    }

    jobList.push(job);
  }

  return payload;
}

async function scheduleJob(
  reservations: SAPReservationDocument[],
): Promise<Response> {
  console.log("Scheduling job with scale API");

  const scaleApiUrl = process.env.SCALE_API_URL;

  if (!scaleApiUrl) {
    throw new Error("SCALE_API_URL is not defined");
  }

  const payload = await buildPayload(reservations);

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

app.post("/api/sync", async (req, res) => {
  const reservations = await getReservations();
  const response = await scheduleJob(reservations);

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
