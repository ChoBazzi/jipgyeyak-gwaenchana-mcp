import { CONTRACT_CHECK_DISCLAIMER, type ContractComparison, type ContractComparisonInput } from '../domain/types.js';
import { dealYmdToRangeEnd, subtractMonths, toDealYmd, toIsoDate } from '../utils/date.js';
import { median, percentDifference, range } from '../utils/stats.js';
import { resolveAddressRegion } from './addressResolver.js';
import type { MolitRentClient } from './molitClient.js';

function summarize(input: ContractComparisonInput, result: ContractComparison): string {
  if (result.sampleCount === 0) {
    return '공공데이터에서 입력 조건과 비교할 유사 신고자료가 부족해 계약 조건 비교를 수행하지 못했습니다. 주소, 기간, 면적 또는 단지명 조건을 더 넓혀 다시 확인해 주세요.';
  }

  const depositDiff = result.depositKrw.differencePercentFromMedian;
  const rentDiff = result.monthlyRentKrw.differencePercentFromMedian;
  const fragments = [`최근 ${result.sampleCount}건의 유사 표본 기준`];

  if (depositDiff !== null) {
    fragments.push(`보증금은 중앙값 대비 ${depositDiff >= 0 ? '+' : ''}${depositDiff}%`);
  }
  if (input.monthlyRentKrw > 0 && rentDiff !== null) {
    fragments.push(`월세는 중앙값 대비 ${rentDiff >= 0 ? '+' : ''}${rentDiff}%`);
  }

  return `${fragments.join(', ')}입니다. 표본 출처와 주소 매칭 정확도를 함께 확인하세요.`;
}

export async function compareContractTerms(
  input: ContractComparisonInput,
  rentClient: MolitRentClient,
  now = new Date()
): Promise<ContractComparison> {
  const monthsBack = input.monthsBack ?? 12;
  const addressResolution = resolveAddressRegion(input.address, input.housingType);
  const to = toDealYmd(now);
  const from = toDealYmd(subtractMonths(now, monthsBack));

  if (!addressResolution.lawdCode) {
    return {
      addressResolution,
      comparableSource: 'unavailable',
      sampleCount: 0,
      period: { from: toIsoDate(subtractMonths(now, monthsBack)), to: dealYmdToRangeEnd(to), monthsBack },
      depositKrw: {
        input: input.depositKrw,
        median: null,
        min: null,
        max: null,
        differenceFromMedian: null,
        differencePercentFromMedian: null
      },
      monthlyRentKrw: {
        input: input.monthlyRentKrw,
        median: null,
        min: null,
        max: null,
        differenceFromMedian: null,
        differencePercentFromMedian: null
      },
      comparisonSummary: '주소를 법정동 코드로 해석할 정보가 부족해 유사 거래 비교를 수행하지 못했습니다.',
      comparables: [],
      dataNotice: addressResolution.dataNotice,
      disclaimer: CONTRACT_CHECK_DISCLAIMER
    };
  }

  const comparableResult = await rentClient.searchRentComparables({
    lawdCode: addressResolution.lawdCode,
    dealYmdFrom: from,
    dealYmdTo: to,
    housingType: input.housingType,
    areaM2: input.areaM2,
    areaToleranceM2: 7,
    complexName: input.complexName,
    limit: 20
  });

  const deposits = comparableResult.deals.map((deal) => deal.depositKrw);
  const rents = comparableResult.deals.map((deal) => deal.monthlyRentKrw);
  const depositMedian = median(deposits);
  const rentMedian = median(rents);
  const depositRange = range(deposits);
  const rentRange = range(rents);

  const result: ContractComparison = {
    addressResolution,
    comparableSource: comparableResult.source,
    sampleCount: comparableResult.deals.length,
    period: { from: toIsoDate(subtractMonths(now, monthsBack)), to: dealYmdToRangeEnd(to), monthsBack },
    depositKrw: {
      input: input.depositKrw,
      median: depositMedian,
      min: depositRange.min,
      max: depositRange.max,
      differenceFromMedian: depositMedian === null ? null : input.depositKrw - depositMedian,
      differencePercentFromMedian: percentDifference(input.depositKrw, depositMedian)
    },
    monthlyRentKrw: {
      input: input.monthlyRentKrw,
      median: rentMedian,
      min: rentRange.min,
      max: rentRange.max,
      differenceFromMedian: rentMedian === null ? null : input.monthlyRentKrw - rentMedian,
      differencePercentFromMedian: percentDifference(input.monthlyRentKrw, rentMedian)
    },
    comparisonSummary: '',
    comparables: comparableResult.deals,
    dataNotice: comparableResult.dataNotice,
    disclaimer: CONTRACT_CHECK_DISCLAIMER
  };

  return {
    ...result,
    comparisonSummary: summarize(input, result)
  };
}
