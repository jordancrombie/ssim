# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including dev)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 ssim

# Copy package files and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Generate Prisma client for production (needs schema)
RUN npx prisma generate

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy views (EJS templates)
COPY --from=builder /app/src/views ./dist/views

# Copy public assets (logo, etc.)
COPY --from=builder /app/src/public ./dist/public

# Set ownership
RUN chown -R ssim:nodejs /app

USER ssim

EXPOSE 3005

ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
