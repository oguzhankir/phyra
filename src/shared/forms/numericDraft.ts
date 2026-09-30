// A partially typed exponent or sign is an editing draft, not a solver input.
export function parseNumericDraft(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
