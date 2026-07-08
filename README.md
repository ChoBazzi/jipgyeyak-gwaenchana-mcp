# 집계약괜찮아 MCP

`집계약괜찮아` PlayMCP용 TypeScript MCP 서버 MVP입니다. 전월세 계약 전 확인을 돕는 보조 정보를 반환하며, 법률/금융/세무/투자 조언으로 쓰지 않도록 모든 도구 응답에 disclaimer를 포함합니다.

## Features

- Streamable HTTP endpoint: `POST /mcp`
- Local STDIO server
- Seed data fallback for local testing
- MOLIT Open Data live client with seed fallback
- PlayMCP-friendly tool descriptions and annotations

## Tools

- `resolve_address_region`: 주소/지역명을 법정동 후보와 `lawdCode` 앞 5자리로 해석합니다.
- `search_rent_comparables`: 유사 전월세 신고 사례를 조회합니다. API 키가 없거나 실패하면 seed data임을 표시합니다.
- `compare_contract_terms`: 입력 계약 조건을 최근 유사 표본의 보증금/월세 중앙값 및 범위와 비교합니다.
- `detect_precontract_red_flags`: 단정적 위험 판정 대신 `checkSignals`와 `itemsToVerify`를 반환합니다.
- `generate_question_checklist`: 임대인/중개사 질문과 확인 서류 목록을 생성합니다.

## Setup

```bash
npm install
cp .env.example .env
```

실제 API 키는 커밋하지 마세요. MVP는 키 없이 seed data로 테스트할 수 있습니다.

```bash
MOLIT_OPEN_DATA_API_KEY=
MOLIT_OPEN_DATA_BASE_URL=https://apis.data.go.kr/1613000
```

`MOLIT_OPEN_DATA_BASE_URL`은 개별 endpoint 전체 URL이 아니라 공공데이터포털 국토교통부 서비스 루트입니다. 기본값은 `https://apis.data.go.kr/1613000`이며, 코드는 `housingType`에 따라 아래 endpoint path를 붙여 호출합니다.

| housingType | endpoint path |
| --- | --- |
| `apartment` | `/RTMSDataSvcAptRent/getRTMSDataSvcAptRent` |
| `officetel` | `/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent` |
| `villa` | `/RTMSDataSvcRHRent/getRTMSDataSvcRHRent` |
| `detachedMultiFamily` | `/RTMSDataSvcSHRent/getRTMSDataSvcSHRent` |

live 요청은 `serviceKey`, `LAWD_CD`, `DEAL_YMD`, `pageNo`, `numOfRows` 파라미터를 사용합니다. 입력 기간 `dealYmdFrom`~`dealYmdTo`는 월 목록으로 펼쳐 각 월별로 호출합니다. API 키가 없거나 live 요청이 실패하면 결과에 `source: "seed"` 및 live 실패 후 seed data를 사용했다는 안내가 포함됩니다.

현재 XML 파서는 국토부 Open API의 단순 `<item>` 목록 응답에서 계약일(`년`, `월`, `일`), 금액(`보증금액`, `월세금액`), 면적(`전용면적`), 지역(`지역코드`, `법정동`), 층, 건축년도, 단지/건물명 필드를 추출하는 MVP 파서입니다. 중첩 구조나 네임스페이스가 필요한 응답으로 확장될 때는 이 파서의 테스트를 먼저 추가해 범위를 넓히세요.

Docker 이미지에 PlayMCP 환경변수 주입이 없을 수 있으면 build arg로 값을 넣을 수 있습니다.

```bash
docker build \
  --build-arg MOLIT_OPEN_DATA_API_KEY="$MOLIT_OPEN_DATA_API_KEY" \
  --build-arg MOLIT_OPEN_DATA_BASE_URL="https://apis.data.go.kr/1613000" \
  -t jipgyeyak-gwaenchana-mcp .
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
http://127.0.0.1:3000/mcp
```

Health check:

```text
http://127.0.0.1:3000/health
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

Seed data is intentionally labeled as seed data. The server must not present seed results as live MOLIT 신고자료. If live MOLIT lookup fails, `FallbackMolitRentClient` returns seed results with a `dataNotice` that explicitly says live API lookup failed before seed data was used.
