import type { RegionCandidate } from '../domain/types.js';

export const SEED_REGIONS: RegionCandidate[] = [
  {
    regionName: '서울특별시 강남구 역삼동',
    lawdCode: '11680',
    legalDongCode: '1168010100',
    sido: '서울특별시',
    sigungu: '강남구',
    eupmyeondong: '역삼동',
    confidence: 'high',
    matchReason: 'seed legal-dong sample'
  },
  {
    regionName: '서울특별시 마포구 아현동',
    lawdCode: '11440',
    legalDongCode: '1144010100',
    sido: '서울특별시',
    sigungu: '마포구',
    eupmyeondong: '아현동',
    confidence: 'high',
    matchReason: 'seed legal-dong sample'
  },
  {
    regionName: '서울특별시 송파구 잠실동',
    lawdCode: '11710',
    legalDongCode: '1171010100',
    sido: '서울특별시',
    sigungu: '송파구',
    eupmyeondong: '잠실동',
    confidence: 'high',
    matchReason: 'seed legal-dong sample'
  },
  {
    regionName: '경기도 성남시 분당구 정자동',
    lawdCode: '41135',
    legalDongCode: '4113510300',
    sido: '경기도',
    sigungu: '성남시 분당구',
    eupmyeondong: '정자동',
    confidence: 'high',
    matchReason: 'seed legal-dong sample'
  },
  {
    regionName: '부산광역시 해운대구 우동',
    lawdCode: '26350',
    legalDongCode: '2635010500',
    sido: '부산광역시',
    sigungu: '해운대구',
    eupmyeondong: '우동',
    confidence: 'high',
    matchReason: 'seed legal-dong sample'
  }
];
