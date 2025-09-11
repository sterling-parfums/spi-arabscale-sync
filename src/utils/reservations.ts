import { getLastSyncTime, updateLastSyncTime } from "./memory";
import { getSAP } from "./sap";

export type SAPReservationDocument = {
  Reservation: string;
  OrderID: string;
  YY1_OrderMaterial_RDH: string;
  _ReservationDocumentItem: Array<{
    Product: string;
    ResvnItmRequiredQtyInBaseUnit: number;
    BaseUnit: string;
  }>;
};
export async function getLatestReservations(): Promise<
  SAPReservationDocument[]
> {
  const lastSync = await getLastSyncTime();
  const lastSyncISO = lastSync.toISOString();
  console.log("ℹ️ Last sync time:", lastSyncISO);

  const filter = [
    [
      `CreationDateTime gt ${lastSyncISO}`,
      `LastChangeDateTime gt ${lastSyncISO}`,
    ],
    ["GoodsMovementType eq '311'"],
    ["startswith(IssuingOrReceivingStorageLoc,'CS')"],
    ["YY1_OrderMaterial_RDH ne ''"],
  ];

  const baseUrl = `${process.env.SAP_API_URL}/sap/opu/odata4/sap/api_reservation_document/srvd_a2x/sap/apireservationdocument/0001`;
  let nextUrl =
    `ReservationDocument` +
    `?$filter=${buildFilter(filter)}` +
    "&$expand=_ReservationDocumentItem($select=Product,ResvnItmRequiredQtyInBaseUnit,BaseUnit)" +
    "&$select=Reservation,OrderID,YY1_OrderMaterial_RDH";

  const docs: SAPReservationDocument[] = [];

  console.log("⌛️ Updating last sync time...");
  const updatedTime = await updateLastSyncTime();
  console.log("✅ Updated last sync time to:", updatedTime.toISOString());

  while (nextUrl) {
    const response = await getSAP(baseUrl + "/" + nextUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch reservations: ${response.statusText}`);
    }

    const body = await response.json();

    if (!body.value || body.value.length === 0) break;

    docs.push(...body.value);

    nextUrl = body["@odata.nextLink"];
  }

  if (docs.length === 0) return docs;

  return docs;
}

export async function getReservation(
  id: string,
): Promise<SAPReservationDocument | null> {
  const baseUrl = `${process.env.SAP_API_URL}/sap/opu/odata4/sap/api_reservation_document/srvd_a2x/sap/apireservationdocument/0001`;
  const url =
    baseUrl +
    `/${id}` +
    "&$expand=_ReservationDocumentItem($select=Product,ResvnItmRequiredQtyInBaseUnit,BaseUnit)" +
    "&$select=Reservation,OrderID,YY1_OrderMaterial_RDH";

  const response = await getSAP(url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch reservation: ${response.statusText}`);
  }

  const body = await response.json();

  return body;
}

function buildFilter(filters: string[][]): string {
  const andConditions = filters.map(
    (orGroup) => "(" + orGroup.join(" or ") + ")",
  );
  const query = andConditions.join(" and ");

  return query;
}
