export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function range(values: number[]): { min: number | null; max: number | null } {
  if (values.length === 0) {
    return { min: null, max: null };
  }

  return { min: Math.min(...values), max: Math.max(...values) };
}

export function percentDifference(input: number, baseline: number | null): number | null {
  if (baseline === null || baseline === 0) {
    return null;
  }

  return Number((((input - baseline) / baseline) * 100).toFixed(1));
}
