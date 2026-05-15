import { describe, it, expect } from 'vitest';
import { orderColor, orderColors } from '@/lib/order-colors';

describe('order-colors', () => {
  it('returns the locked Coleoptera hot pink', () => {
    expect(orderColor('Coleoptera')).toBe('#FF6EC7');
  });

  it('returns Other for unknown order', () => {
    expect(orderColor('Strepsiptera')).toBe(orderColors.Other);
  });

  it('returns Other for null/undefined', () => {
    expect(orderColor(null)).toBe(orderColors.Other);
    expect(orderColor(undefined)).toBe(orderColors.Other);
  });

  it('exports exactly the 17 documented hex codes', () => {
    expect(Object.keys(orderColors).length).toBe(17);
    expect(orderColors.Lepidoptera).toBe('#F8B4D9');
    expect(orderColors.Diptera).toBe('#A78BFA');
    expect(orderColors.Odonata).toBe('#67D4E6');
  });
});
