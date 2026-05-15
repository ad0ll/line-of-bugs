import { orderColor } from "@/lib/order-colors";

interface Props {
  order: string | null;
  size?: "sm" | "md";
}

// Text-first badge: the order name spelled out (e.g. "Coleoptera"), tinted with
// its locked palette color. Art students aren't entomologists — color alone
// doesn't communicate "beetle"; the word + color together does.
export function OrderBadge({ order, size = "sm" }: Props) {
  if (!order) return null;
  const color = orderColor(order);
  return (
    <span
      className={`order-badge order-badge-${size}`}
      style={{
        // Color the text in the order's hue + a tinted fill at low alpha
        // (we read color via CSS to keep this style block static).
        color,
        background: `${color}1c`, // ~11% alpha
        borderColor: `${color}55`, // ~33% alpha
      }}
    >
      {order}
    </span>
  );
}
