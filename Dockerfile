FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dependencies AS development
COPY . .
EXPOSE 5178
CMD ["npm", "run", "dev"]

FROM dependencies AS build
COPY . .
RUN npm run build && npm test

FROM node:22-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
USER node
EXPOSE 8080
CMD ["node", "dist-server/index.js"]
