FROM node:20-alpine AS deps
RUN apk add --no-cache python3 py3-pip ffmpeg ca-certificates
WORKDIR /app
COPY package*.json ./
RUN npm install debug --no-audit --no-fund --ignore-scripts \
 && npm install --no-audit --no-fund --ignore-scripts \
 && node node_modules/youtube-dl-exec/scripts/postinstall.js || true \
 && pip3 install --break-system-packages --upgrade yt-dlp

FROM deps AS build
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
RUN apk add --no-cache python3 py3-pip ffmpeg ca-certificates \
 && pip3 install --break-system-packages --upgrade yt-dlp
WORKDIR /app
ENV NODE_ENV=production
ENV YOUTUBE_DL_PATH=/usr/bin/yt-dlp
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
EXPOSE 3000
CMD ["npm", "start"]
