# 1) Compila la app de React
FROM node:24-alpine AS client
WORKDIR /app/client
COPY client/package.json ./
RUN npm install --no-audit --no-fund
COPY client ./
RUN npm run build

# 2) Servidor Node que sirve la API, el stream en directo y la web
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY server/src ./server/src
COPY --from=client /app/client/dist ./client/dist
EXPOSE 4100
CMD ["node", "server/src/index.js"]
