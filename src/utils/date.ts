export const DEAL_YMD_PATTERN = /^\d{4}(0[1-9]|1[0-2])$/;

export function toDealYmd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function subtractMonths(date: Date, months: number): Date {
  const targetMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)
  ).getUTCDate();
  targetMonth.setUTCDate(Math.min(date.getUTCDate(), lastDayOfTargetMonth));
  return targetMonth;
}

export function isValidDealYmd(value: string): boolean {
  return DEAL_YMD_PATTERN.test(value);
}

export function assertValidDealYmdRange(from: string, to: string): void {
  if (!isValidDealYmd(from) || !isValidDealYmd(to)) {
    throw new Error('조회 월은 유효한 YYYYMM 형식이어야 합니다.');
  }
  if (from > to) {
    throw new Error('조회 시작 월은 종료 월보다 늦을 수 없습니다.');
  }
}

export function dealYmdToRangeStart(dealYmd: string): string {
  return `${dealYmd.slice(0, 4)}-${dealYmd.slice(4, 6)}-01`;
}

export function dealYmdToRangeEnd(dealYmd: string): string {
  const year = Number(dealYmd.slice(0, 4));
  const month = Number(dealYmd.slice(4, 6));
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
