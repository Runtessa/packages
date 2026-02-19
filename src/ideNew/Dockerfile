FROM node:22-bullseye-slim AS builder

WORKDIR /app/src/ideNew

ENV NEXT_TELEMETRY_DISABLED=1

# Build this image from repository root:
# docker build -f src/ideNew/Dockerfile .
COPY src/packages/shared /app/src/packages/shared
COPY src/ideNew/package*.json ./

RUN npm install
RUN mkdir -p /app/src \
    && ln -s /app/src/ideNew/node_modules /app/src/node_modules

COPY src/packages /app/src/packages
COPY src/ideNew /app/src/ideNew

RUN npm run build

FROM node:22-bullseye-slim AS runner

WORKDIR /app/src/ideNew

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/src/ideNew/package*.json ./
COPY --from=builder /app/src/ideNew/node_modules ./node_modules
COPY --from=builder /app/src/packages/shared /app/src/packages/shared
RUN npm prune --omit=dev --ignore-scripts \
    && npm cache clean --force
RUN mkdir -p /app/src \
    && ln -s /app/src/ideNew/node_modules /app/src/node_modules

COPY --from=builder /app/src/ideNew/.next ./.next
COPY --from=builder /app/src/ideNew/public ./public
COPY --from=builder /app/src/ideNew/next.config.mjs ./next.config.mjs
COPY --from=builder /app/src/ideNew/postcss.config.js ./postcss.config.js
COPY --from=builder /app/src/ideNew/tailwind.config.js ./tailwind.config.js

ENV PORT=3000

USER node

CMD ["npm", "run", "start"]
