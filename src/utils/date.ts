export function toDealYmd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function subtractMonths(date: Date, months: number): Date {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCMonth(next.getUTCMonth() - months);
  return next;
}

export function dealYmdToRangeStart(dealYmd: string): string {
  return `${dealYmd.slice(0, 4)}-${dealYmd.slice(4, 6)}-01`;
}

export function dealYmdToRangeEnd(dealYmd: string): string {
  const year = Number(dealYmd.slice(0, 4));
  const month = Number(dealYmd.slice(4, 6));
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
