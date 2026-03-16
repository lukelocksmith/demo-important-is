FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY src/ ./src/

VOLUME ["/data"]
EXPOSE 3000

ENV NODE_ENV=production
ENV DATA_DIR=/data/projects

CMD ["bun", "src/index.ts"]
