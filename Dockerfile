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
ARG MOLIT_OPEN_DATA_API_KEY=
ARG MOLIT_OPEN_DATA_BASE_URL=https://apis.data.go.kr/1613000
ENV NODE_ENV=production
ENV MOLIT_OPEN_DATA_API_KEY=${MOLIT_OPEN_DATA_API_KEY}
ENV MOLIT_OPEN_DATA_BASE_URL=${MOLIT_OPEN_DATA_BASE_URL}
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/http.js"]
