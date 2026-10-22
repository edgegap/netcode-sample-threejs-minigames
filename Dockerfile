# One image holds the server of every game; the GAME env var on the Edgegap app version picks one.
#   docker build --platform linux/amd64 -t registry.edgegap.com/<project>/threejs-minigames:<tag> .
#   docker run --rm -e GAME=blaster -p 7777:7777 registry.edgegap.com/<project>/threejs-minigames:<tag>
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=7777
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
# Only the server half of each game goes into the image.
COPY games/blaster/server.js ./games/blaster/server.js
COPY games/kart/server.js ./games/kart/server.js
COPY games/soccer/server.js ./games/soccer/server.js
COPY games/cycles/server.js ./games/cycles/server.js
COPY games/sumo/server.js ./games/sumo/server.js
# Internal port. The app version maps it as "gameport", protocol WS, TLS Upgrade on.
EXPOSE 7777/tcp
USER node
# Node is PID 1, so it receives Edgegap's SIGTERM directly.
CMD ["node", "server/main.js"]
