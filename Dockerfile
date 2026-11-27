FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# wait-port solo se usa en docker-compose local (servicio postgres_db).
RUN npm install -g wait-port

# Con DATABASE_URL (Neon/Railway) arranca directo; sin ella espera al Postgres local.
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then npm start; else wait-port postgres_db:5432 && npm start; fi"]