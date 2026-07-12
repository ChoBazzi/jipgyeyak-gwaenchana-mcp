FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV MCP_HOST=0.0.0.0
ENV MOLIT_OPEN_DATA_BASE_URL=https://apis.data.go.kr/1613000
ENV MOLIT_OPEN_DATA_TIMEOUT_MS=10000
ENV MOLIT_OPEN_DATA_TOTAL_TIMEOUT_MS=10000
ENV CONTRACT_LOOKUP_TIMEOUT_MS=15000
ENV MCP_ALLOWED_ORIGINS=https://playmcp.kakao.com
ENV MCP_RATE_LIMIT_PER_MINUTE=120
ENV MCP_MAX_CONCURRENT_REQUESTS=16
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/http.js"]
