import { getSAP } from "./sap";

const productCache: Record<string, SAPProduct> = {};

type SAPProduct = {
  d: {
    Product: string;
    ProductGroup: string;
    to_Description: {
      results: Array<{
        ProductDescription: string;
      }>;
    };
  };
};
export async function getProductName(id: string): Promise<string | null> {
  if (productCache[id]) {
    return toProductName(productCache[id]);
  }

  const product = await getProduct(id);
  if (!product) {
    return null;
  }

  productCache[id] = product;

  return toProductName(productCache[id]);
}

export async function getProduct(id: string): Promise<SAPProduct | null> {
  if (productCache[id]) {
    return productCache[id];
  }

  const baseUrl = process.env.SAP_API_URL;
  const url =
    `${baseUrl}/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product` +
    `('${id}')` +
    `?$expand=to_Description` +
    `&$select=Product,ProductGroup,to_Description/ProductDescription`;

  const response = await getSAP(url);

  if (!response.ok) {
    return null;
  }

  const product = (await response.json()) as SAPProduct;
  productCache[id] = product;

  return productCache[id];
}

export function toProductName(product: SAPProduct | null): string {
  if (!product) return "";
  return product.d.to_Description.results[0]?.ProductDescription;
}

export function isDispensable(product: SAPProduct | null): boolean {
  if (!product) return false;

  return (
    product.d.ProductGroup.startsWith("1CHM") ||
    product.d.ProductGroup.startsWith("1OIL")
  );
}
