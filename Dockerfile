FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Arranque directo. En docker-compose local el wait a Postgres va en `command:`.
CMD ["npm", "start"]