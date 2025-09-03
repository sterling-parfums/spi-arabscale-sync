import { getSAP } from "./sap";

export type SAPProcessOrder = {
  Material: string;
};
export async function getProcessOrder(
  id: string,
): Promise<SAPProcessOrder | null> {
  const baseUrl = process.env.SAP_API_URL;
  const url =
    `${baseUrl}/sap/opu/odata/sap/API_PROCESS_ORDER_2_SRV/A_ProcessOrder_2` +
    `('${id}')` +
    `?$select=Material,TotalQuantity`;

  const response = await getSAP(url);

  if (!response.ok) {
    console.error(
      `Failed to fetch process order ${id}: ${response.statusText}`,
    );
    return null;
  }

  const order = await response.json();

  return order.d;
}
