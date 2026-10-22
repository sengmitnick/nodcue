FROM node:22.17.0-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server ./server

USER node
EXPOSE 3200
CMD ["npm", "start"]
