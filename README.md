# 집계약괜찮아 MCP

`집계약괜찮아` PlayMCP용 TypeScript MCP 서버 MVP입니다. 전월세 계약 전 확인을 돕는 보조 정보를 반환하며, 법률/금융/세무/투자 조언으로 쓰지 않도록 모든 도구 응답에 disclaimer를 포함합니다.

## Features

- Streamable HTTP endpoint: `POST /mcp`
- Local STDIO server
- MOLIT Open Data live client
- Juso road-name address lookup for address candidates and `lawdCode` extraction
- Insufficient live data is reported explicitly
- PlayMCP-friendly tool descriptions and annotations

## Tools

- `resolve_address_region`: 주소/지역명을 법정동 후보와 `lawdCode` 앞 5자리로 해석합니다.
- `search_rent_comparables`: 유사 전월세 신고 사례를 조회합니다. API 키가 없거나 조회가 실패하면 정보 부족 안내를 반환합니다.
- `compare_contract_terms`: 입력 계약 조건을 최근 유사 표본의 보증금/월세 중앙값 및 범위와 비교합니다.
- `detect_precontract_red_flags`: 단정적 위험 판정 대신 `checkSignals`와 `itemsToVerify`를 반환합니다.
- `generate_question_checklist`: 임대인/중개사 질문과 확인 서류 목록을 생성합니다.

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
JUSO_API_KEY=
JUSO_API_BASE_URL=https://business.juso.go.kr/addrlink/addrLinkApi.do
JUSO_API_TIMEOUT_MS=3000
```

`JUSO_API_KEY`는 도로명주소 주소기반산업지원서비스 검색 API 키입니다. `resolve_address_region`은 먼저 이 API로 사용자가 입력한 단지명/부분주소의 주소 후보를 찾고, 후보의 `bdMgtSn` 또는 `admCd` 앞 5자리에서 국토교통부 전월세 API 조회에 필요한 `lawdCode`를 추출합니다. 키가 없거나 조회가 실패하면 fake 후보를 만들지 않고 기존 내장 행정구역 키워드 매핑을 확인하며, 둘 다 실패하면 정보 부족 안내를 반환합니다.

`MOLIT_OPEN_DATA_BASE_URL`은 개별 endpoint 전체 URL이 아니라 공공데이터포털 국토교통부 서비스 루트입니다. 기본값은 `https://apis.data.go.kr/1613000`이며, 코드는 `housingType`에 따라 아래 endpoint path를 붙여 호출합니다.

| housingType | endpoint path |
| --- | --- |
| `apartment` | `/RTMSDataSvcAptRent/getRTMSDataSvcAptRent` |
| `officetel` | `/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent` |
| `villa` | `/RTMSDataSvcRHRent/getRTMSDataSvcRHRent` |
| `detachedMultiFamily` | `/RTMSDataSvcSHRent/getRTMSDataSvcSHRent` |

live 요청은 `serviceKey`, `LAWD_CD`, `DEAL_YMD`, `pageNo`, `numOfRows` 파라미터를 사용합니다. 입력 기간 `dealYmdFrom`~`dealYmdTo`는 최신 월부터 펼치고 최대 3개월씩 병렬 조회합니다. 각 월은 응답의 `totalCount`와 `numOfRows`를 확인해 전체 페이지를 읽으며, 요청한 `limit`만큼 최근 표본을 확보하면 이전 월 조회를 중단합니다. 이때 `searchComplete: false`와 실제 조회한 월 수를 반환해 요청 기간 전체 건수와 혼동하지 않게 합니다. 비정상 응답의 무한 요청을 막기 위해 월별 최대 20페이지로 제한하며, 요청 타임아웃 기본값은 5초이고 `MOLIT_OPEN_DATA_TIMEOUT_MS`로 조정할 수 있습니다.

단지명은 공백과 기호, `아파트`·`오피스텔` 같은 일반 주택 유형 표현을 정규화해 비교합니다. 따라서 `은마아파트`와 API의 `은마`, `대우마리나`와 `대우마리나1` 같은 표기 차이를 허용합니다. `contractType`이 주어지면 전세와 월세 신고 사례를 분리하며, `compare_contract_terms`는 입력 월세가 0원이면 전세, 0원보다 크면 월세 표본만 사용합니다. API 키가 없거나 live 요청이 실패하면 결과에 `source: "unavailable"`과 재시도 안내가 포함되고, 조회 성공 후 조건 일치 결과가 0건이면 별도의 조건 부족 안내가 포함됩니다.

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
JUSO_API_KEY=<도로명주소 API 키>
JUSO_API_BASE_URL=https://business.juso.go.kr/addrlink/addrLinkApi.do
JUSO_API_TIMEOUT_MS=3000
```

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
