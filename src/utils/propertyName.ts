const GENERIC_PROPERTY_TERMS = /아파트|오피스텔|주상복합|연립주택|다세대주택|단독주택|다가구주택|빌라/gu;
const NON_DISTINCT_BRAND_TOKENS = new Set(['APT', 'M2']);
const KOREAN_LOCATION_QUALIFIER =
  /^(?=.{2,14}$)[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|시|군|구|읍|면|동|리|로|길|역)$/u;

function normalizePropertyName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(GENERIC_PROPERTY_TERMS, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/(\d+)차$/u, '$1');
}

function hasKoreanLocationQualifier(longer: string, shorter: string): boolean {
  const extra = longer.startsWith(shorter)
    ? longer.slice(shorter.length)
    : longer.endsWith(shorter)
      ? longer.slice(0, -shorter.length)
      : '';
  const asciiLetterCount = (shorter.match(/[a-z]/g) ?? []).length;

  return asciiLetterCount >= 4 && KOREAN_LOCATION_QUALIFIER.test(extra);
}

export function asciiBrandTokens(value: string): string[] {
  return [
    ...new Set(
      (value.normalize('NFKC').match(/[A-Za-z][A-Za-z0-9]{1,}/g) ?? [])
        .map((token) => token.toUpperCase())
        .filter((token) => !NON_DISTINCT_BRAND_TOKENS.has(token))
    )
  ];
}

export function candidateBrandIdentityMatches(requestedText: string, candidateName: string | undefined): boolean {
  if (!candidateName) return false;
  const requestedTokens = new Set(asciiBrandTokens(requestedText));
  const candidateTokens = asciiBrandTokens(candidateName);
  const hasDistinctiveIdentity =
    candidateTokens.length >= 2 || candidateTokens.some((token) => token.replace(/\d/g, '').length >= 4);

  return (
    hasDistinctiveIdentity &&
    candidateTokens.length > 0 &&
    candidateTokens.every((token) => requestedTokens.has(token))
  );
}

export function reportedPropertyNamesMatch(requestedName: string, actualName: string | undefined): boolean {
  const requested = normalizePropertyName(requestedName);
  const actual = actualName ? normalizePropertyName(actualName) : '';
  if (!requested || !actual) return false;
  if (requested === actual) return true;

  const [shorter, longer] = requested.length <= actual.length ? [requested, actual] : [actual, requested];
  return hasKoreanLocationQualifier(longer, shorter);
}
