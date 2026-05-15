import { orderColor } from '@/lib/order-colors';

export function GridTileStripe({ taxonOrder }: { taxonOrder: string | null }) {
  return <span className="grid-item-stripe" style={{ backgroundColor: orderColor(taxonOrder) }} />;
}
