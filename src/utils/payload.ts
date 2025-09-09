import { getProduct, isDispensable, toProductName } from "./products";
import type { SAPReservationDocument } from "./reservations";

export type Payload = { JOB_LIST: JobList };
export type JobList = Job[];
export type Job = {
  JOB_NO: string;
  PRODUCT_CODE: string;
  PRODUCT_NAME: string;
  BATCH_NO: string;
  BATCH_WEIGHT: number;
  SCHEDULE_DATE: string;
  INGREDIENT_LIST: Ingredient[];
};
export type Ingredient = {
  INGREDIENT_CODE: string;
  INGREDIENT_NAME: string;
  INGREDIENT_LOT: Array<{
    LOT_NO: string;
    EXPIRY_DATE: string;
    MANUFACTURER_NAME: string;
    TARGET_WEIGHT: number;
    UNIT: string;
  }>;
};
export async function buildJobsPayload(
  reservations: SAPReservationDocument[],
): Promise<Payload> {
  const payload: Payload = { JOB_LIST: [] };
  const jobList = payload.JOB_LIST;
  const NA = "N/A" as const;
  const now = new Date();

  for (const reservation of reservations) {
    // TODO: Add material name and code on job
    const product = reservation.YY1_OrderMaterial_RDH
      ? await getProduct(reservation.YY1_OrderMaterial_RDH)
      : null;
    const job: Job = {
      JOB_NO: reservation.Reservation,
      PRODUCT_CODE: product ? product.d.Product : "0000",
      PRODUCT_NAME: product ? toProductName(product) : NA,
      BATCH_NO: NA,
      BATCH_WEIGHT: 0,
      SCHEDULE_DATE: now.toISOString(),
      INGREDIENT_LIST: [],
    };

    const ingredientList = job.INGREDIENT_LIST;
    for (const item of reservation._ReservationDocumentItem) {
      const product = await getProduct(item.Product);
      if (!isDispensable(product)) continue;

      const ingredient: Ingredient = {
        INGREDIENT_CODE: item.Product,
        INGREDIENT_NAME: toProductName(product),
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

    if (job.INGREDIENT_LIST.length === 0) continue;

    job.BATCH_WEIGHT = ingredientList.reduce((acc, item) => {
      return (
        acc +
        item.INGREDIENT_LOT.reduce((sum, lot) => sum + lot.TARGET_WEIGHT, 0)
      );
    }, 0);

    jobList.push(job);
  }

  return payload;
}
