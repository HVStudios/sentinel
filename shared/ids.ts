/** Stable node-id helpers shared by ingestion (server) and analyses that run in the browser. */
export const slug = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';

export const vendorNodeId = (vendor: string) => `vendor:${slug(vendor)}`;
export const productNodeId = (vendor: string, product: string) => `product:${slug(vendor)}/${slug(product)}`;
