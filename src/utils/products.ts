import { getSAP } from "./sap";

const productNameCache: Record<string, string> = {};

type SAPProduct = {
  d: {
    Product: string;
    to_Description: {
      ProductDescription: string;
    };
  };
};
export async function getProductName(id: string): Promise<string | null> {
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
