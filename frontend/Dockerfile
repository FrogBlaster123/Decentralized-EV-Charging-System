FROM node:18-alpine

WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .

# Vite default port
EXPOSE 5173
CMD ["npm", "run", "dev"]
