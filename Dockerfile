FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json ./
RUN bun install

COPY src/ ./src/

RUN bun build src/siteping-init.ts --outfile dist/siteping.js --target browser --minify

VOLUME ["/data"]
EXPOSE 3000

ENV NODE_ENV=production
ENV DATA_DIR=/data/projects

CMD ["bun", "src/index.ts"]
