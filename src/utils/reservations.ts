import { getLastReservationId, setLastReservationId } from "./memory";
import { getSAP } from "./sap";

export type SAPReservationDocument = {
  Reservation: string;
  OrderID: string;
  _ReservationDocumentItem: Array<{
    Product: string;
    ResvnItmRequiredQtyInBaseUnit: number;
    BaseUnit: string;
  }>;
};
export async function getReservations(): Promise<SAPReservationDocument[]> {
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
