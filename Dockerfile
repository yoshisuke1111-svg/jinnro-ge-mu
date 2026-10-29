FROM node:24-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
USER node
EXPOSE 3000
CMD ["node", "server.js"]
