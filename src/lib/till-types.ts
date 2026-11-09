export type TillItem = {
  variantId: number; name: string; size: string; sku: string; barcode: string; priceCents: number; onHand: number;
  photo: string | null; category: string; lowStock: number;
};
export type PosCategory = { slug: string; name: string; count: number };
