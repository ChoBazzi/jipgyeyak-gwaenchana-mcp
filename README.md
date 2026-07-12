# 집계약괜찮아 MCP

`집계약괜찮아` PlayMCP용 TypeScript MCP 서버 MVP입니다. 전월세 계약 전 확인을 돕는 보조 정보를 반환하며, 법률/금융/세무/투자 조언으로 쓰지 않도록 모든 도구 응답에 disclaimer를 포함합니다.

## Features

- Streamable HTTP endpoint: `POST /mcp`
- Local STDIO server
- MOLIT Open Data live client
- Juso road-name address lookup for address candidates and `lawdCode` extraction
- Insufficient live data is reported explicitly
- Machine-readable lookup status, reason codes, filter counts, and next actions
- PlayMCP-friendly tool descriptions and annotations

## Tools

- `resolve_address_region`: 주소/지역명을 법정동 후보와 `lawdCode` 앞 5자리로 해석합니다.
- `search_rent_comparables`: 유사 전월세 신고 사례를 조회합니다. API 키가 없거나 조회가 실패하면 정보 부족 안내를 반환합니다.
- `compare_contract_terms`: 입력 계약 조건을 최근 유사 표본의 보증금/월세 중앙값 및 범위와 비교합니다.
- `detect_precontract_check_signals`: 단정적 위험 판정 대신 `checkSignals`와 `itemsToVerify`를 반환합니다.
- `generate_question_checklist`: 임대인/중개사 질문과 확인 서류 목록을 생성합니다.

## Response states

`search_rent_comparables`는 문장형 `dataNotice`와 함께 다음 구조화 필드를 반환합니다.

- `status`: `MATCHES_FOUND`, `NO_MATCHES`, `LIVE_DATA_UNAVAILABLE`
- `reasonCode`: 결과가 없는 단계 또는 실패 원인
- `retryable`: 같은 조건으로 잠시 후 재시도할 수 있는지 여부
- `filterStats`: `raw` -> `afterContractType` -> `afterComplexName` -> `afterArea` 단계별 건수
- `nextActions`: 조건 수정, 주소 보완 또는 운영 설정 확인 등 다음 행동

조회 성공 후 자료가 없으면 `NO_REPORTED_DEALS`, `NO_CONTRACT_TYPE_MATCH`, `NO_COMPLEX_MATCH`, `NO_AREA_MATCH` 중 하나를 반환합니다. 조회 자체가 불가능하면 `API_KEY_MISSING`, `API_AUTH_ERROR`, `API_TIMEOUT`, `API_HTTP_ERROR`, `API_RESPONSE_INVALID`, `API_REQUEST_FAILED`, `INVALID_REQUEST`로 원인을 구분합니다.

`resolve_address_region`도 `lookupStatus`, `lookupReasonCode`, `retryable`, `nextActions`를 반환합니다. 주소 API 조회 성공 후 후보가 없으면 `NO_MATCHES`/`NO_ADDRESS_MATCH`, 키·인증·연결 문제면 `LIVE_DATA_UNAVAILABLE`과 구체적인 API 원인을 반환합니다. 따라서 주소를 더 구체적으로 써야 하는 경우와 서비스 설정 또는 일시 장애를 구분할 수 있습니다.

`compare_contract_terms`는 위 정보를 이어받아 `COMPARED`, `NO_MATCHES`, `ADDRESS_UNRESOLVED`, `ADDRESS_AMBIGUOUS`, `LIVE_DATA_UNAVAILABLE` 중 하나를 반환합니다. 정확히 일치하는 도로명주소 또는 같은 단지의 여러 동은 하나의 조회 대상으로 처리하고, 서로 다른 주소 후보가 남으면 첫 후보를 임의로 사용하지 않고 `ADDRESS_AMBIGUOUS`와 더 구체적인 주소 입력 안내를 반환합니다. 기존 `dataNotice`, `comparisonSummary`, `comparables` 필드는 그대로 유지됩니다.

월세는 보증금과 월세를 각각 중앙값과 비교하며, 전월세전환율을 적용한 등가 비교가 아니라는 설명을 함께 반환합니다. 계약 전 확인 신호도 확정적인 사기·위험 판정이 아니라 추가 확인이 필요한 항목으로만 표현합니다.

## Setup

```bash
npm install
cp .env.example .env
```

실제 API 키는 커밋하지 마세요. API 키가 없으면 실시간 신고자료를 조회하지 않으며, 정보 부족 안내를 반환합니다.

```bash
PORT=8080
MCP_HOST=0.0.0.0
MOLIT_OPEN_DATA_API_KEY=
MOLIT_OPEN_DATA_BASE_URL=https://apis.data.go.kr/1613000
MOLIT_OPEN_DATA_TIMEOUT_MS=5000
MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS=2800
JUSO_API_KEY=
JUSO_API_BASE_URL=https://business.juso.go.kr/addrlink/addrLinkApi.do
JUSO_API_TIMEOUT_MS=3000
CONTRACT_LOOKUP_TIMEOUT_MS=3000
MCP_ALLOWED_ORIGINS=https://playmcp.kakao.com
MCP_RATE_LIMIT_PER_MINUTE=120
MCP_MAX_CONCURRENT_REQUESTS=16
```

`JUSO_API_KEY`는 도로명주소 주소기반산업지원서비스 검색 API 키입니다. `resolve_address_region`은 먼저 이 API로 사용자가 입력한 단지명/부분주소의 주소 후보를 찾고, 후보의 현재 `admCd` 앞 5자리에서 국토교통부 전월세 API 조회에 필요한 `lawdCode`를 추출합니다. `admCd`가 없는 예외 응답에서만 `bdMgtSn`을 사용합니다. 이 우선순위는 행정구역 개편 뒤 건물관리번호에 과거 구 코드가 남은 지역을 잘못 조회하지 않기 위한 것입니다. 키가 없거나 조회가 실패하면 fake 후보를 만들지 않고 기존 내장 행정구역 키워드 매핑을 확인하며, 둘 다 실패하면 정보 부족 안내를 반환합니다.

`MOLIT_OPEN_DATA_BASE_URL`은 개별 endpoint 전체 URL이 아니라 공공데이터포털 국토교통부 서비스 루트입니다. 기본값은 `https://apis.data.go.kr/1613000`이며, 코드는 `housingType`에 따라 아래 endpoint path를 붙여 호출합니다.

| housingType | endpoint path |
| --- | --- |
| `apartment` | `/RTMSDataSvcAptRent/getRTMSDataSvcAptRent` |
| `officetel` | `/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent` |
| `villa` | `/RTMSDataSvcRHRent/getRTMSDataSvcRHRent` |
| `detachedMultiFamily` | `/RTMSDataSvcSHRent/getRTMSDataSvcSHRent` |

live 요청은 `serviceKey`, `LAWD_CD`, `DEAL_YMD`, `pageNo`, `numOfRows` 파라미터를 사용합니다. 입력 기간은 최대 12개월, 반환 표본은 최대 20건이며 계약 비교는 최근 10건을 목표로 합니다. `dealYmdFrom`~`dealYmdTo`는 최신 한 달을 먼저 조회하고, 표본이 부족할 때만 이전 월을 최대 3개월씩 병렬 확장합니다. 각 월은 응답의 `totalCount`와 `numOfRows`를 확인해 페이지를 읽고, 필터 조건에 맞는 표본을 요청한 `limit`만큼 확보하면 해당 월의 남은 페이지와 이전 월 조회를 중단합니다. 목표 건수 확보 또는 전체 마감시간 도달로 조기 종료할 때 검증된 표본이 있으면 이를 반환하고 `searchComplete: false`와 실제 조회한 월 수를 표시합니다. 표본이 전혀 없는 타임아웃만 `LIVE_DATA_UNAVAILABLE`로 처리합니다. 비정상 응답의 무한 요청을 막기 위해 월별 최대 20페이지로 제한합니다. 개별 요청 타임아웃은 `MOLIT_OPEN_DATA_TIMEOUT_MS`, 국토부 전체 조회 마감시간은 `MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS`, 주소 해석부터 비교까지의 전체 마감시간은 `CONTRACT_LOOKUP_TIMEOUT_MS`로 설정합니다. 전체 마감시간 설정은 최대 3초로 제한됩니다.

단지명은 공백과 기호, `아파트`·`오피스텔` 같은 일반 주택 유형 표현을 정규화해 비교합니다. 따라서 `은마아파트`와 API의 `은마`, `대우마리나`와 `대우마리나1` 같은 표기 차이를 허용합니다. `contractType`이 주어지면 전세와 월세 신고 사례를 분리하며, `compare_contract_terms`는 입력 월세가 0원이면 전세, 0원보다 크면 월세 표본만 사용합니다. API 키가 없거나 live 요청이 실패하면 결과에 `source: "unavailable"`, 실패 원인과 다음 행동이 포함되고, 조회 성공 후 조건 일치 결과가 0건이면 어느 필터 단계에서 제외됐는지 안내합니다.

역할을 구분하면, 도로명주소 API는 입력 주소/단지명을 행정구역 후보와 `lawdCode`로 해석하는 단계에 사용하고, 국토교통부 Open API는 해석된 `lawdCode`로 실제 전월세 신고 사례를 조회하는 단계에 사용합니다.

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
MOLIT_OPEN_DATA_TIMEOUT_MS=5000
MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS=2800
JUSO_API_KEY=<도로명주소 API 키>
JUSO_API_BASE_URL=https://business.juso.go.kr/addrlink/addrLinkApi.do
JUSO_API_TIMEOUT_MS=3000
CONTRACT_LOOKUP_TIMEOUT_MS=3000
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

If live MOLIT lookup cannot run or fails, `FallbackMolitRentClient` returns `source: "unavailable"`, an empty `deals` array, and a `dataNotice` that explains why the information is insufficient.

주소에는 비교 대상 건물까지만 입력하고 세부 동/호수, 임대인·임차인 이름, 전화번호, 이메일 등 개인정보를 넣지 마세요. MCP 입력 스키마는 과도하게 긴 값과 연락처 형식을 거부합니다. 도구 응답은 최대 24KB로 제한되며, 초과 시 조건을 좁혀 다시 조회하라는 `RESULT_TOO_LARGE` 오류를 반환합니다.
