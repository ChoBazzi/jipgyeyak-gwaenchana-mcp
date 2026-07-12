# 집계약괜찮아 MCP

`집계약괜찮아` PlayMCP용 TypeScript MCP 서버 MVP입니다. 전월세 계약 전 확인을 돕는 보조 정보를 반환하며, 법률/금융/세무/투자 조언으로 쓰지 않도록 모든 도구 응답에 disclaimer를 포함합니다.

## Features

- Streamable HTTP endpoint: `POST /mcp`
- Local STDIO server
- MOLIT live clients for rent and sale transactions
- Juso road-name address lookup for address candidates and `lawdCode` extraction
- Insufficient live data is reported explicitly
- Machine-readable lookup status, reason codes, filter counts, and next actions
- PlayMCP-friendly tool descriptions and annotations

## Tools

- `resolve_address_region`: 주소/지역명을 법정동 후보와 `lawdCode` 앞 5자리로 해석합니다.
- `search_rent_comparables`: 법정동 코드와 기간이 확인된 저수준 유사 전월세 검색입니다. 주소와 계약금액 비교에는 직접 사용하지 않습니다.
- `compare_contract_terms`: 도로명주소에서 확인한 신고 건물·단지명과 법정동이 일치하는 유사 면적 전월세·매매 자료를 비교합니다.
- `detect_precontract_check_signals`: 주소·보증금·월세·면적이 모두 제공된 계약 검토에서 우선 사용하며, 최상위 `screeningSummary`와 `pricePosition`으로 가격 질문에 직접 답하는 대표 스크리닝 도구입니다.
- `generate_question_checklist`: 임대인/중개사 질문과 확인 서류 목록을 생성합니다.

## Response states

`search_rent_comparables`는 문장형 `dataNotice`와 함께 다음 구조화 필드를 반환합니다.

- `status`: `MATCHES_FOUND`, `NO_MATCHES`, `LIVE_DATA_UNAVAILABLE`
- `reasonCode`: 결과가 없는 단계 또는 실패 원인
- `retryable`: 같은 조건으로 잠시 후 재시도할 수 있는지 여부
- `filterStats`: `raw` -> `afterContractType` -> `afterLegalDong` -> `afterComplexName` -> `afterArea` 단계별 건수
- `nextActions`: 조건 수정, 주소 보완 또는 운영 설정 확인 등 다음 행동

조회 성공 후 자료가 없으면 `NO_REPORTED_DEALS`, `NO_CONTRACT_TYPE_MATCH`, `NO_LEGAL_DONG_MATCH`, `NO_COMPLEX_MATCH`, `NO_AREA_MATCH` 중 하나를 반환합니다. 조회 자체가 불가능하면 `API_KEY_MISSING`, `API_AUTH_ERROR`, `API_TIMEOUT`, `API_HTTP_ERROR`, `API_RESPONSE_INVALID`, `API_REQUEST_FAILED`, `INVALID_REQUEST`로 원인을 구분합니다.

`resolve_address_region`도 `lookupStatus`, `lookupReasonCode`, `retryable`, `nextActions`를 반환합니다. 주소 API 조회 성공 후 후보가 없으면 `NO_MATCHES`/`NO_ADDRESS_MATCH`, 키·인증·연결 문제면 `LIVE_DATA_UNAVAILABLE`과 구체적인 API 원인을 반환합니다. 지역과 영문 브랜드가 함께 입력된 경우에는 해당 시군구와 주택유형을 조합한 보조 검색을 한 번 수행하며, 후보 건물명의 영문 브랜드 토큰이 입력과 모두 일치할 때만 `BRAND_ASSISTED_MATCH_FOUND`로 표시합니다. `판교SK허브`처럼 한글 음역 때문에 브랜드를 검증할 수 없는 표기는 잘못된 SK 건물을 선택하지 않고 정확한 도로명주소나 `SK HUB` 공식 표기를 다시 묻습니다. 보조 검색에도 실패한 건물명은 `판교` 같은 생활권 별칭만으로 `판교동`을 추측하지 않습니다. 서로 다른 지역 후보가 남거나 단독 동명만으로 확정 근거가 부족하면 `AMBIGUOUS`/`MULTIPLE_ADDRESS_MATCHES`와 `clarificationQuestion`, 중복 제거된 `clarificationOptions`를 반환합니다. 에이전트는 첫 후보를 사용하지 않고 이 질문을 사용자에게 전달한 뒤 보완된 주소로 다시 호출해야 합니다.

`compare_contract_terms`는 위 정보를 이어받아 `COMPARED`, `NO_MATCHES`, `ADDRESS_UNRESOLVED`, `ADDRESS_AMBIGUOUS`, `LIVE_DATA_UNAVAILABLE` 중 하나를 반환합니다. 정확히 일치하는 주소나 고유한 부분 건물명은 Juso의 공식 건물명으로 보완하고, 국토교통부 자료에서는 법정동과 정규화된 신고 건물·단지명이 모두 정확히 일치하는 자료만 핵심 비교에 사용합니다. 국토교통부 신고자료에는 Juso 건물관리번호가 없으므로 아파트 개별 동·호 동일성까지 입증하지는 않습니다. 사용자가 입력한 건물명을 Juso에서 확인하지 못하면 `REQUESTED_PROPERTY_REFERENCE`, 건물명을 확정하지 못하면 `SAME_LEGAL_DONG` 또는 `DISTRICT_REFERENCE` 참고자료로 표시하며 계약 단위 결과에 사용하지 않습니다.

모든 비교에는 `comparisonScope`, `scopeReason`, `areaToleranceM2`, `searchComplete`, `confidence`, `confidenceReasons`가 포함됩니다. 면적 허용 범위는 입력 면적의 10%를 기본으로 최소 2㎡, 최대 7㎡입니다. 최종 `screeningOutcome`은 다음 세 값 중 하나입니다.

`detect_precontract_check_signals`의 `pricePosition`은 검증된 동일 신고 건물·단지명 표본에 한해 입력 가격을 `BELOW_COMPARABLE_RANGE`, `WITHIN_COMPARABLE_RANGE`, `ABOVE_COMPARABLE_RANGE`, `INSUFFICIENT_DATA`로 구분하고 입력값·중앙값·범위·표본 수를 함께 반환합니다. `screeningSummary`는 이 가격 위치와 매매가 대비 보증금 비율을 먼저 설명한 뒤 데이터 한계와 별도 확인 항목을 안내합니다.

사용자가 주택 유형에 맞는 면적을 제공하지 않은 경우 `detect_precontract_check_signals`의 `areaM2`는 생략합니다. 서버는 외부 API를 호출하거나 면적을 추측하지 않고 `MISSING_REQUIRED_INPUT`, `missingFields`, `clarificationQuestion`을 반환합니다. 아파트·오피스텔·연립다세대는 전용면적을, 단독다가구는 공공데이터 계약면적/연면적 기준을 질문하며 에이전트는 사용자가 확인한 값으로 다시 호출합니다.

- `NO_ADDITIONAL_PRICE_SIGNAL_FOUND`: 검증된 신고 건물·단지명과 법정동의 충분한 가격 자료에서 추가 가격 확인 신호가 발견되지 않음. 권리관계나 계약 안전 확인을 뜻하지 않음
- `ADDITIONAL_VERIFICATION_REQUIRED`: 조건 차이, 낮은 신뢰도, 매매가 대비 보증금 수준 등 추가 확인 필요
- `INSUFFICIENT_INFORMATION`: 주소, 검증된 신고 건물·단지명 표본 또는 공공데이터가 부족해 계약 단위 점검 불가

주소 선택은 특정 지명을 위한 예외 목록이 아니라 다음 공통 규칙을 따릅니다.

1. 입력과 정확히 일치하는 도로명주소 또는 지번주소가 있으면 해당 후보를 사용합니다.
2. 입력에 포함된 시·도, 시·군·구, 읍·면·동을 Juso 응답의 행정구역 필드와 비교해 후보를 좁힙니다.
3. 서로 다른 `lawdCode` 후보가 남거나 상위 행정구역이 없는 단독 동명 검색이면 사용자에게 다시 질문합니다.
4. `complexName`은 사용자가 실제 단지·건물명을 명시한 경우에만 사용하며, `중동아파트`처럼 일반 주택 유형을 제거하면 행정동 이름만 남는 표현은 자동 선택 근거로 사용하지 않습니다.

| 입력 | 처리 |
| --- | --- |
| `중동` | 여러 지역 후보를 제시하고 시군구를 다시 질문 |
| `우동` | 후보 지역을 확인하는 질문 반환 |
| `부천 중동` | 부천시 원미구 중동 참고자료 조회, 계약 단위 결과는 정보 부족 |
| `부산 우동` | 부산 해운대구 우동 참고자료 조회, 계약 단위 결과는 정보 부족 |
| 정확한 도로명·지번주소 | 정확히 일치하는 주소 후보로 조회 |

월세는 입력 보증금과 차이가 25% 이내인 거래만 짝지어 월세 중앙값을 계산합니다. 가까운 보증금 표본이 3건보다 적으면 월세 가격 이상을 단정하지 않고 `WOLSE_COMPARISON_LIMITED`를 반환합니다. 전월세전환율을 적용한 등가 비교는 아닙니다.

도로명주소에서 신고 건물·단지명이 확인되면 전월세 조회와 매매 조회를 병렬로 실행합니다. `salePriceAssessment`에는 법정동과 신고 건물·단지명이 일치하는 유사 면적 매매가 표본과 보증금/매매가 중앙값 비율이 포함됩니다. 80% 이상은 추가 확인 신호를 만드는 서비스 내부 기준일 뿐 법률, 보증보험 가입 또는 대출 심사 기준이 아닙니다. 매매 자료가 없거나 API 활용 권한이 없으면 확인하지 못한 항목으로 표시하며 안전하다고 간주하지 않습니다.

## 표현 원칙

- `집계약괜찮아`는 실거래 조건 비교, 추가 확인 신호, 계약 전 질문 목록을 제공합니다.
- 결과를 `전세사기 판정`, `안전한 계약`, `위험 확정`으로 표현하지 않습니다.
- 모든 도구 응답은 전세사기 여부나 계약 안전성을 판정 또는 보장하지 않는다는 disclaimer를 포함합니다.
- 실제 계약 판단에는 등기부등본, 건축물대장, 중개대상물 확인설명서, 공적 신고자료와 전문가 확인이 별도로 필요합니다.

## Setup

```bash
npm install
cp .env.example .env
```

실제 API 키는 커밋하지 마세요. API 키가 없으면 공공데이터 API 신고자료를 조회하지 않으며, 정보 부족 안내를 반환합니다. 같은 공공데이터포털 서비스 키를 사용하지만 전월세 API와 주택 유형별 매매 API는 각각 활용신청과 승인이 필요합니다. API 호출 성공은 최신 계약이 즉시 신고됐다는 의미가 아니므로 결과의 조회 기간과 최신 `contractDate`를 함께 확인해야 합니다.

```bash
PORT=8080
MCP_HOST=0.0.0.0
MOLIT_OPEN_DATA_API_KEY=
MOLIT_OPEN_DATA_BASE_URL=https://apis.data.go.kr/1613000
MOLIT_OPEN_DATA_TIMEOUT_MS=10000
MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS=10000
JUSO_API_KEY=
JUSO_API_BASE_URL=https://business.juso.go.kr/addrlink/addrLinkApi.do
JUSO_API_TIMEOUT_MS=3000
CONTRACT_LOOKUP_TIMEOUT_MS=15000
MCP_ALLOWED_ORIGINS=https://playmcp.kakao.com
MCP_RATE_LIMIT_PER_MINUTE=120
MCP_MAX_CONCURRENT_REQUESTS=16
```

`JUSO_API_KEY`는 도로명주소 주소기반산업지원서비스 검색 API 키입니다. `resolve_address_region`은 먼저 이 API로 사용자가 입력한 단지명/부분주소의 주소 후보를 찾고, 후보의 현재 `admCd` 앞 5자리에서 국토교통부 전월세 API 조회에 필요한 `lawdCode`를 추출합니다. `admCd`가 없는 예외 응답에서만 `bdMgtSn`을 사용합니다. 이 우선순위는 행정구역 개편 뒤 건물관리번호에 과거 구 코드가 남은 지역을 잘못 조회하지 않기 위한 것입니다. 키가 없거나 조회가 실패하면 fake 후보를 만들지 않고 기존 내장 행정구역 키워드 매핑을 확인하며, 둘 다 실패하면 정보 부족 안내를 반환합니다.

`MOLIT_OPEN_DATA_BASE_URL`은 개별 endpoint 전체 URL이 아니라 공공데이터포털 국토교통부 서비스 루트입니다. 기본값은 `https://apis.data.go.kr/1613000`이며, 코드는 `housingType`에 따라 아래 endpoint path를 붙여 호출합니다.

| housingType | rent endpoint | sale endpoint |
| --- | --- | --- |
| `apartment` | `/RTMSDataSvcAptRent/getRTMSDataSvcAptRent` | `/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade` |
| `officetel` | `/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent` | `/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade` |
| `villa` | `/RTMSDataSvcRHRent/getRTMSDataSvcRHRent` | `/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade` |
| `detachedMultiFamily` | `/RTMSDataSvcSHRent/getRTMSDataSvcSHRent` | `/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade` |

live 요청은 `serviceKey`, `LAWD_CD`, `DEAL_YMD`, `pageNo`, `numOfRows` 파라미터를 사용합니다. 입력 기간은 최대 12개월, 반환 표본은 최대 20건이며 계약 비교는 최근 10건을 목표로 합니다. 전월세와 매매 조회는 주소 해석 뒤 같은 전체 마감시간 안에서 병렬 실행합니다. 최신 월부터 조회하고 표본이 부족하면 이전 월을 확장하며, 응답의 `totalCount`와 `numOfRows`를 확인해 페이지를 읽습니다. 목표 건수 확보 또는 마감시간 도달로 조기 종료하면 `searchComplete: false`와 실제 조회 월 수를 표시합니다. 표본이 전혀 없는 타임아웃만 `LIVE_DATA_UNAVAILABLE`로 처리합니다. 비정상 응답의 무한 요청을 막기 위해 월별 최대 20페이지로 제한합니다. 개별 API 요청과 국토부 전체 조회의 기본 마감시간은 10초, 주소 해석부터 계약 비교까지의 전체 마감시간은 15초입니다. 이 값이 운영자가 설정할 수 있는 상한이기도 하므로 과도한 대기로 늘어나지 않습니다.

공공데이터 XML에서 바이트 기준으로 동일한 임대차 행이 반복되면 한 건으로 계산합니다. 매매 자료에 해제 여부(`cdealType`) 또는 해제일이 표시되면 해당 행뿐 아니라 계약일·금액·면적·층·건물명 등 공개 거래 식별값이 같은 원거래 행도 유효 매매 표본에서 제외합니다.

단지명은 공백과 기호, `아파트`·`오피스텔` 같은 일반 주택 유형 표현을 정규화한 뒤 일치 여부를 확인합니다. `은마아파트`와 API의 `은마`, Juso의 `SK HUB 오피스텔`과 국토부의 `판교역 SK HUB`처럼 영문 브랜드 앞뒤에 한글 지역 한정어만 붙은 표기는 같은 건물 후보로 허용합니다. Juso의 `대우마리나1차아파트`와 국토부의 `대우마리나1`처럼 이름 끝의 차수 숫자가 같은 표기는 매칭하지만, `대우마리나`와 `대우마리나1`처럼 번호가 생략되거나 다른 이름은 합치지 않습니다. `contractType`이 주어지면 전세와 월세 신고 사례를 분리하며, `compare_contract_terms`는 입력 월세가 0원이면 전세, 0원보다 크면 월세 표본만 사용합니다. API 키가 없거나 요청이 실패하면 결과에 `source: "unavailable"`, 실패 원인과 다음 행동이 포함되고, 조회 성공 후 조건 일치 결과가 0건이면 어느 필터 단계에서 제외됐는지 안내합니다.

면적은 아파트·오피스텔·연립다세대의 경우 전용면적만 입력합니다. 면적 불일치 시 허용 범위를 넓히기 전에 공급면적을 입력하지 않았는지 먼저 안내합니다. 단독다가구는 공공데이터가 제공하는 계약면적/연면적 필드 기준으로 비교하며, 서로 다른 면적 종류를 자동 환산하거나 추측하지 않습니다.

역할을 구분하면, 도로명주소 API는 입력 주소/단지명을 행정구역 후보, 공식 건물명과 `lawdCode`로 해석하고, 국토교통부 Open API는 법정동과 신고 건물·단지명이 일치하는 전월세·매매 사례를 조회합니다. 두 API 사이에는 공통 건물관리번호가 없어 이름과 법정동 일치 범위만 보장합니다. 등기부등본, 건축물대장, 임대인 권리관계와 보증보험 가능 여부는 자동 조회하지 않으며 `notAutomaticallyVerifiedItems`로 명시합니다.

현재 XML 파서는 국토부 Open API의 단순 `<item>` 목록 응답에서 계약일(`dealYear`/`년`, `dealMonth`/`월`, `dealDay`/`일`), 금액(`deposit`/`보증금액`, `monthlyRent`/`월세금액`), 면적(`excluUseAr`, `totalFloorAr`, `전용면적`), 지역(`sggCd`/`지역코드`, `umdNm`/`법정동`), 층, 건축년도, 단지/건물명 필드를 추출합니다. 중첩 구조나 네임스페이스가 필요한 응답으로 확장될 때는 이 파서의 테스트를 먼저 추가해 범위를 넓히세요.

Docker 이미지는 API 키 없이 빌드합니다. PlayMCP/Kakao Cloud 배포 환경변수에 `MOLIT_OPEN_DATA_API_KEY`와 `JUSO_API_KEY`를 런타임 변수로 등록하세요.

```bash
docker build -t jipgyeyak-gwaenchana-mcp .
```

Git 저장소 배포 방식에서는 저장소 URL과 브랜치만 연결하고, 배포 설정의 환경변수에 아래 값을 추가합니다.

```text
PORT=8080
MCP_HOST=0.0.0.0
MOLIT_OPEN_DATA_API_KEY=<국토교통부 Open API 키>
MOLIT_OPEN_DATA_BASE_URL=https://apis.data.go.kr/1613000
MOLIT_OPEN_DATA_TIMEOUT_MS=10000
MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS=10000
JUSO_API_KEY=<도로명주소 API 키>
JUSO_API_BASE_URL=https://business.juso.go.kr/addrlink/addrLinkApi.do
JUSO_API_TIMEOUT_MS=3000
CONTRACT_LOOKUP_TIMEOUT_MS=15000
MCP_ALLOWED_ORIGINS=https://playmcp.kakao.com
MCP_RATE_LIMIT_PER_MINUTE=120
MCP_MAX_CONCURRENT_REQUESTS=16
```

`MCP_ALLOWED_ORIGINS`는 쉼표로 구분한 정확한 HTTP(S) Origin 목록입니다. Origin 헤더가 있는 요청은 이 목록과 일치해야 하며, 서버 간 MCP 요청처럼 Origin 헤더가 없는 요청은 허용합니다.

인증을 사용하지 않는 공개 MCP의 외부 API 쿼터를 보호하기 위해 프로세스당 기본 분당 120개, 동시 16개 요청으로 제한합니다. `MCP_RATE_LIMIT_PER_MINUTE`와 `MCP_MAX_CONCURRENT_REQUESTS`로 조정할 수 있으며 각각 최대 1000, 64로 제한됩니다. 다중 인스턴스 배포에서는 PlayMCP 또는 Kubernetes 게이트웨이의 공용 제한도 함께 적용하세요.

## Scripts

```bash
npm test
npm run typecheck
npm run build
npm run dev:http
npm run start:http
```

## HTTP

```bash
npm run dev:http
```

Default endpoint:

```text
http://127.0.0.1:8080/mcp
```

Health check:

```text
http://127.0.0.1:8080/health
```

API 키 준비 상태 확인은 `/ready`를 사용합니다. 두 API 키가 모두 설정되지 않으면 HTTP 503과 각 의존성 상태를 반환하지만, 프로세스 생존 여부를 확인하는 `/health`는 계속 HTTP 200을 반환합니다.

## STDIO

```bash
npm run build
npm run start:stdio
```

Built binary entry:

```bash
node dist/stdio.js
```

## Data Notice

If live MOLIT lookup cannot run or fails, the rent and sale clients return `source: "unavailable"`, an empty `deals` array, and a `dataNotice` that explains why the information is insufficient. No generated or fallback transaction data is used.

주소에는 비교 대상 건물까지만 입력하고 세부 동/호수, 임대인·임차인 이름, 전화번호, 이메일 등 개인정보를 넣지 마세요. MCP 입력 스키마는 과도하게 긴 값과 연락처 형식을 거부합니다. 도구 응답은 최대 24KB로 제한되며, 초과 시 조건을 좁혀 다시 조회하라는 `RESULT_TOO_LARGE` 오류를 반환합니다.
