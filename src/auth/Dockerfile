FROM node:20-bullseye-slim

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV AUTH_HOST=0.0.0.0
ENV AUTH_PORT=3015

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

EXPOSE 3015

CMD ["npm", "run", "start"]
