FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends iproute2 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/neorest/package.json packages/neorest/package.json
COPY packages/tests/package.json packages/tests/package.json
COPY packages/benchmark/package.json packages/benchmark/package.json
RUN npm ci

COPY tsconfig.json ./
COPY packages/neorest packages/neorest
COPY packages/benchmark packages/benchmark
RUN npm run build

ENTRYPOINT ["bash", "packages/benchmark/live-audio-netem.sh"]
