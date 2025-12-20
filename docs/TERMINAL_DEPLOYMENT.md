# SSIM Terminal Integration - Production Deployment Guide

**Version:** 1.15.0
**Date:** 2025-12-20
**Branch:** `feature/terminal-integration`

## Overview

This deployment adds hardware payment terminal support to SSIM, enabling ESP32-based terminals to display QR codes for mobile wallet payments via mwsim.

### New Features
- WebSocket server for real-time terminal communication (`/terminal/ws`)
- Terminal pairing with 6-digit codes
- Admin UI for terminal management (`/admin/terminals`)
- Merchant interface for initiating terminal payments (`/terminal`)

---

## Pre-Deployment Checklist

- [ ] Backup production database
- [ ] Verify WSIM environment variables are configured (see below)
- [ ] Notify team of deployment window
- [ ] Ensure ECS task definitions are updated with new image

---

## 1. Database Migration

### Migration Required
```
20251219192251_add_terminal_models
```

### Tables Created
- `terminals` - Stores registered payment terminals
- `terminal_pairing_codes` - Temporary pairing codes for terminal registration

### ECS One-Off Task Command

Since direct database access is not available, run the migration using an ECS one-off task:

```bash
# Option 1: Using AWS CLI
aws ecs run-task \
  --cluster ssim-production \
  --task-definition ssim-migration \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --overrides '{
    "containerOverrides": [{
      "name": "ssim",
      "command": ["npx", "prisma", "migrate", "deploy"]
    }]
  }'

# Option 2: If using automated migrations in Dockerfile
# The migration runs automatically on container startup if configured with:
# CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
```

### Verify Migration Success
After the task completes, check the logs for:
```
Prisma Migrate applied the following migration(s):
20251219192251_add_terminal_models
```

---

## 2. Environment Variables

### Required Variables (Already Configured)
These should already be set from the mobile payment integration:

| Variable | Description | Example |
|----------|-------------|---------|
| `WSIM_ENABLED` | Enable WSIM integration | `true` |
| `WSIM_API_KEY` | WSIM Merchant API key | `wsim-merchant-key` |
| `WSIM_MOBILE_API_URL` | WSIM Mobile Payment API | `https://wsim.example.com/api/mobile/payment` |
| `WSIM_QR_BASE_URL` | Base URL for QR payment links | `https://wsim.example.com/pay` |
| `APP_BASE_URL` | SSIM public URL | `https://ssim.example.com` |

### No New Environment Variables Required
The terminal integration uses existing WSIM configuration.

---

## 3. Deployment Steps

### Step 1: Build and Push New Image
```bash
# Build the new image
docker build -t ssim:1.15.0 .

# Tag for ECR
docker tag ssim:1.15.0 <account>.dkr.ecr.<region>.amazonaws.com/ssim:1.15.0
docker tag ssim:1.15.0 <account>.dkr.ecr.<region>.amazonaws.com/ssim:latest

# Push to ECR
docker push <account>.dkr.ecr.<region>.amazonaws.com/ssim:1.15.0
docker push <account>.dkr.ecr.<region>.amazonaws.com/ssim:latest
```

### Step 2: Run Database Migration
Execute the ECS one-off task as described in Section 1.

### Step 3: Update ECS Service
```bash
# Force new deployment with latest image
aws ecs update-service \
  --cluster ssim-production \
  --service ssim-service \
  --force-new-deployment
```

### Step 4: Verify Deployment
```bash
# Check service status
aws ecs describe-services \
  --cluster ssim-production \
  --services ssim-service \
  --query 'services[0].deployments'
```

---

## 4. Post-Deployment Verification

### Health Check
```bash
curl https://ssim.example.com/health
# Expected: {"status":"ok","timestamp":"..."}
```

### WebSocket Endpoint
Verify the terminal WebSocket server is accessible:
```bash
# Should return 426 Upgrade Required (indicates WebSocket endpoint is active)
curl -I https://ssim.example.com/terminal/ws
```

### Admin UI
1. Log in as admin user
2. Navigate to `/admin/terminals`
3. Verify page loads without errors
4. (Optional) Create a test terminal to verify database connectivity

### Verify Logs
Check ECS logs for successful startup:
```
[Terminal WS] WebSocket server initialized on /terminal/ws
```

---

## 5. Rollback Procedure

If issues occur, rollback to the previous version:

### Step 1: Revert ECS Service
```bash
# Update service to previous image tag
aws ecs update-service \
  --cluster ssim-production \
  --service ssim-service \
  --task-definition ssim:previous-version \
  --force-new-deployment
```

### Step 2: Rollback Migration (if needed)
**Note:** Only rollback the migration if you need to completely remove terminal support.

```bash
# Run via ECS one-off task
aws ecs run-task \
  --cluster ssim-production \
  --task-definition ssim-migration \
  --overrides '{
    "containerOverrides": [{
      "name": "ssim",
      "command": ["npx", "prisma", "migrate", "resolve", "--rolled-back", "20251219192251_add_terminal_models"]
    }]
  }'
```

Then manually drop the tables if needed:
```sql
-- Run via ECS one-off task with psql or prisma db execute
DROP TABLE IF EXISTS terminal_pairing_codes;
DROP TABLE IF EXISTS terminals;
```

---

## 6. Known Issues / Notes

### Terminal Firmware Dependency
The terminal hardware (ESP32) requires firmware that handles the `payment_complete` WebSocket message. Until firmware is updated, terminals will continue showing QR codes after payment completion (the `/terminal` web page will show the correct status).

### WSIM Constraint
Each terminal payment must have a unique `orderId` in WSIM. The system automatically uses the internal payment ID (`tpay_xxx`) to ensure uniqueness.

---

## 7. Support Contacts

| Team | Responsibility |
|------|----------------|
| SSIM Team | Backend, Admin UI, API |
| ssimTerminal Team | ESP32 firmware |
| WSIM Team | Mobile payment API |

---

## Appendix: New Routes Summary

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/terminal` | GET | Admin | Terminal payment UI |
| `/terminal/payment` | POST | Admin | Initiate payment |
| `/terminal/payment/:id/status` | GET | Admin | Poll payment status |
| `/terminal/payment/:id/cancel` | POST | Admin | Cancel payment |
| `/terminal/payment-complete` | GET | Public | Return from mwsim |
| `/terminal/ws` | WS | API Key | Terminal WebSocket |
| `/api/terminal/pair` | POST | Public | Complete pairing |
| `/api/terminal/config` | GET | API Key | Get terminal config |
| `/api/terminal/heartbeat` | POST | API Key | HTTP heartbeat |
| `/admin/terminals` | GET | Admin | Terminal list |
| `/admin/terminals/new` | GET/POST | Admin | Add terminal |
| `/admin/terminals/:id` | GET | Admin | Terminal details |
