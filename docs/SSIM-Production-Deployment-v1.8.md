# SSIM v1.8.x Production Deployment Guide

**For the BSIM Team**

This document provides step-by-step instructions for deploying SSIM v1.8.2 to production on AWS ECS.

## Summary of Changes (v1.7.0 → v1.8.2)

### New Features
- **WSIM Wallet Payment Integration** (v1.7.0)
  - Pay with digital wallet alongside bank payments
  - WSIM OIDC client for wallet authorization flow
  - Wallet callback handler and dual token support

- **WSIM Merchant API Integration** (v1.8.0-v1.8.2)
  - API-based checkout options (API, API Direct, API Proxy)
  - Custom card selection UI with passkey authentication
  - WebAuthn/Passkey integration for secure payments

### New Environment Variables Required

| Variable | Required | Description | Example Value |
|----------|----------|-------------|---------------|
| `WSIM_ENABLED` | Yes | Enable wallet payments | `true` |
| `WSIM_AUTH_URL` | Yes | WSIM OIDC provider URL | `https://wsim-auth.banksim.ca` |
| `WSIM_CLIENT_ID` | Yes | OAuth client ID for WSIM | `ssim-merchant` |
| `WSIM_CLIENT_SECRET` | Yes | OAuth client secret for WSIM | `<secret>` |
| `WSIM_POPUP_URL` | Yes | WSIM popup URL for embedded flow | `https://wsim-auth.banksim.ca` |
| `WSIM_API_KEY` | Yes | API key for WSIM Merchant API | `<api-key>` |
| `WSIM_API_URL` | Yes | WSIM Merchant API endpoint | `https://wsim.banksim.ca/api/merchant` |
| `ADMIN_ENABLED` | Optional | Enable admin dashboard (default: true) | `true` |
| `ADMIN_EMAILS` | Optional | Authorized admin email addresses | `admin@banksim.ca` |

---

## Database Requirements

### This Release: No Database Changes Required

**SSIM v1.8.x does NOT require any database migrations or schema changes.**

SSIM uses in-memory storage for:
- Orders
- Products
- Shopping carts

There is no PostgreSQL database to migrate. Simply deploy the new Docker image with the updated environment variables.

> **Note for BSIM Team:** Unlike other services in the ecosystem (BSIM auth-server, NSIM), SSIM does not connect to the shared RDS PostgreSQL database. You can skip any database-related steps for this deployment.

### For Future Reference: Running Database Migrations via ECS Tasks

If a future SSIM release DOES require database changes, **do NOT use psql directly** - production RDS is not publicly accessible. Instead, use ECS run-task to execute migrations:

```bash
# Example: Running a Prisma migration via ECS task
# (NOT needed for v1.8.x - this is for future reference only)

aws ecs run-task \
  --cluster bsim-cluster \
  --task-definition bsim-ssim \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-zzz],assignPublicIp=ENABLED}" \
  --overrides '{
    "containerOverrides": [
      {
        "name": "ssim",
        "command": ["npx", "prisma", "migrate", "deploy"]
      }
    ]
  }' \
  --region ca-central-1

# Monitor the migration task
aws logs tail /ecs/bsim-ssim --follow --region ca-central-1
```

For SQL-based migrations (not Prisma), create a one-off task definition that runs the migration script:

```bash
# Example: Running raw SQL migration
aws ecs run-task \
  --cluster bsim-cluster \
  --task-definition bsim-ssim \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-zzz],assignPublicIp=ENABLED}" \
  --overrides '{
    "containerOverrides": [
      {
        "name": "ssim",
        "command": ["node", "-e", "const sql = require(\"./migrations/v1.9.0.js\"); sql.run();"]
      }
    ]
  }' \
  --region ca-central-1
```

**Important:** Always run migrations BEFORE deploying the new application version to avoid schema mismatches.

---

## Deployment Steps

### Step 1: Build and Push Docker Image

```bash
# From SSIM repository root
cd /path/to/ssim

# Ensure you're on the latest main branch
git pull origin main

# Login to ECR
aws ecr get-login-password --region ca-central-1 | \
  docker login --username AWS --password-stdin 301868770392.dkr.ecr.ca-central-1.amazonaws.com

# Build for linux/amd64 (required for ECS Fargate)
docker buildx build --platform linux/amd64 \
  -t bsim/ssim:latest \
  -t bsim/ssim:v1.8.2 \
  .

# Tag for ECR
docker tag bsim/ssim:latest 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/ssim:latest
docker tag bsim/ssim:v1.8.2 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/ssim:v1.8.2

# Push to ECR
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/ssim:latest
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/ssim:v1.8.2
```

### Step 2: Update Task Definition

The existing task definition at `ssim-task-definition.json` needs new environment variables. Here's the updated version:

```json
{
  "family": "bsim-ssim",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::301868770392:role/bsim-ecs-task-execution-role",
  "containerDefinitions": [
    {
      "name": "ssim",
      "image": "301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/ssim:latest",
      "portMappings": [
        {
          "containerPort": 3005,
          "protocol": "tcp"
        }
      ],
      "essential": true,
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3005" },
        { "name": "SESSION_SECRET", "value": "idIhtiTOfG+wfTYw06oKWaVYZ5T2b7m/rg+tQY9jCW8=" },
        { "name": "TRUST_PROXY", "value": "true" },
        { "name": "APP_BASE_URL", "value": "https://ssim.banksim.ca" },
        { "name": "OPENBANKING_API_URL", "value": "https://openbanking.banksim.ca" },
        { "name": "OIDC_PROVIDERS", "value": "[{\"id\":\"bsim\",\"name\":\"BSIM Bank\",\"issuer\":\"https://auth.banksim.ca\",\"clientId\":\"ssim-client\",\"clientSecret\":\"e829e6a1a87565b56a419c94c7780f4e2774de7ee98d5d0a98a343786b4598dd\",\"scopes\":\"openid profile email fdx:accountdetailed:read fdx:transactions:read\"}]" },
        { "name": "PAYMENT_API_URL", "value": "https://payment.banksim.ca" },
        { "name": "PAYMENT_AUTH_URL", "value": "https://auth.banksim.ca" },
        { "name": "PAYMENT_CLIENT_ID", "value": "ssim-client" },
        { "name": "PAYMENT_CLIENT_SECRET", "value": "e829e6a1a87565b56a419c94c7780f4e2774de7ee98d5d0a98a343786b4598dd" },
        { "name": "MERCHANT_ID", "value": "ssim-client" },
        { "name": "WEBHOOK_SECRET", "value": "ssim-webhook-secret-prod" },

        { "name": "ADMIN_ENABLED", "value": "true" },
        { "name": "ADMIN_EMAILS", "value": "ssim.adminuser@banksim.ca" },

        { "name": "WSIM_ENABLED", "value": "true" },
        { "name": "WSIM_AUTH_URL", "value": "https://wsim-auth.banksim.ca" },
        { "name": "WSIM_CLIENT_ID", "value": "ssim-merchant" },
        { "name": "WSIM_CLIENT_SECRET", "value": "<WSIM_CLIENT_SECRET_HERE>" },
        { "name": "WSIM_POPUP_URL", "value": "https://wsim-auth.banksim.ca" },
        { "name": "WSIM_API_KEY", "value": "<WSIM_API_KEY_HERE>" },
        { "name": "WSIM_API_URL", "value": "https://wsim.banksim.ca/api/merchant" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/bsim-ssim",
          "awslogs-region": "ca-central-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "wget -qO- http://localhost:3005/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

**Important:** Replace `<WSIM_CLIENT_SECRET_HERE>` and `<WSIM_API_KEY_HERE>` with the actual production values from the WSIM team.

### Step 3: Register New Task Definition

```bash
# Register the updated task definition
aws ecs register-task-definition \
  --cli-input-json file://ssim-task-definition.json \
  --region ca-central-1
```

### Step 4: Update ECS Service

```bash
# Force new deployment with updated task definition
aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-ssim-service \
  --force-new-deployment \
  --region ca-central-1
```

### Step 5: Monitor Deployment

```bash
# Watch deployment progress
aws ecs describe-services \
  --cluster bsim-cluster \
  --services bsim-ssim-service \
  --region ca-central-1

# Check task health
aws ecs describe-tasks \
  --cluster bsim-cluster \
  --tasks $(aws ecs list-tasks --cluster bsim-cluster --service-name bsim-ssim-service --query 'taskArns[0]' --output text --region ca-central-1) \
  --region ca-central-1

# View logs
aws logs tail /ecs/bsim-ssim --follow --region ca-central-1
```

---

## WSIM Prerequisites (Database Setup Required)

**The `ssim-merchant` OAuth client must be registered in WSIM's database before SSIM can use wallet payments.**

### Step 1: Generate Secrets

```bash
# Generate WSIM_CLIENT_SECRET (use this in both SQL and SSIM env var)
openssl rand -base64 32
# Example output: K7mN9pQ2rS5tV8wX1yZ4aB7cD0eF3gH6

# Generate WSIM_API_KEY (use this in both SQL and SSIM env var)
echo "wsim_api_$(openssl rand -hex 16)"
# Example output: wsim_api_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

**Save these values!** You'll need them for both the SQL INSERT and SSIM's environment variables.

### Step 2: Register OAuth Client in WSIM Database (via ECS Task)

**Remember: No direct psql access in production.** Use an ECS run-task to execute the SQL.

Create a file `register-ssim-oauth-client.json`:

```json
{
  "cluster": "bsim-cluster",
  "taskDefinition": "wsim-auth-server",
  "launchType": "FARGATE",
  "networkConfiguration": {
    "awsvpcConfiguration": {
      "subnets": ["subnet-xxx", "subnet-yyy"],
      "securityGroups": ["sg-zzz"],
      "assignPublicIp": "ENABLED"
    }
  },
  "overrides": {
    "containerOverrides": [
      {
        "name": "wsim-auth-server",
        "command": [
          "node", "-e",
          "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.oAuthClient.create({data:{clientId:'ssim-merchant',clientSecret:'<HASHED_CLIENT_SECRET>',clientName:'SSIM Store Simulator',redirectUris:['https://ssim.banksim.ca/payment/wallet-callback'],grantTypes:['authorization_code'],responseTypes:['code'],scope:'openid profile wallet:pay',isActive:true}}).then(c=>console.log('Created:',c.clientId)).catch(e=>console.error(e)).finally(()=>p.$disconnect());"
        ]
      }
    ]
  }
}
```

**Important:** The `clientSecret` in the database should be bcrypt-hashed. If WSIM uses plain secrets, use the generated value directly. If it uses bcrypt:

```bash
# Hash the secret (run locally or in a Node container)
node -e "const bcrypt=require('bcrypt');bcrypt.hash('<YOUR_GENERATED_SECRET>',10).then(h=>console.log(h))"
```

Run the task:

```bash
aws ecs run-task \
  --cli-input-json file://register-ssim-oauth-client.json \
  --region ca-central-1

# Monitor the task output
aws logs tail /ecs/wsim-auth-server --follow --region ca-central-1
```

### Step 3: Register API Key in WSIM Database (via ECS Task)

If WSIM uses an `api_keys` table, register the API key similarly:

```bash
aws ecs run-task \
  --cluster bsim-cluster \
  --task-definition wsim-auth-server \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-zzz],assignPublicIp=ENABLED}" \
  --overrides '{
    "containerOverrides": [
      {
        "name": "wsim-auth-server",
        "command": ["node", "-e", "const{PrismaClient}=require(\"@prisma/client\");const p=new PrismaClient();p.apiKey.create({data:{key:\"<YOUR_WSIM_API_KEY>\",clientId:\"ssim-merchant\",isActive:true}}).then(k=>console.log(\"Created API key for:\",k.clientId)).catch(e=>console.error(e)).finally(()=>p.$disconnect());"]
      }
    ]
  }' \
  --region ca-central-1
```

### Step 4: Configure CORS (if using API Direct mode)

If SSIM will use the "API (Direct)" button (browser → WSIM directly), WSIM needs CORS headers:

- Allow origin: `https://ssim.banksim.ca`
- Allow credentials: `true`
- Allow headers: `Content-Type, Authorization`

### Summary: Values to Use in SSIM Task Definition

After completing the above steps, update SSIM's task definition with:

| Environment Variable | Value |
|---------------------|-------|
| `WSIM_CLIENT_ID` | `ssim-merchant` |
| `WSIM_CLIENT_SECRET` | The plain-text secret you generated in Step 1 |
| `WSIM_API_KEY` | The API key you generated in Step 1 |
| `WSIM_AUTH_URL` | `https://wsim-auth.banksim.ca` |
| `WSIM_POPUP_URL` | `https://wsim-auth.banksim.ca` |
| `WSIM_API_URL` | `https://wsim.banksim.ca/api/merchant` |

---

## Verification Checklist

After deployment, verify:

- [ ] Health check passes: `curl https://ssim.banksim.ca/health`
- [ ] Homepage loads: `https://ssim.banksim.ca`
- [ ] Bank payment works (Pay with BSIM)
- [ ] Wallet popup payment works (if WSIM is deployed)
- [ ] Wallet API payment works (if WSIM API is deployed)
- [ ] Admin dashboard accessible: `https://ssim.banksim.ca/admin`
- [ ] CloudWatch logs show no errors

---

## Rollback Procedure

If issues occur, rollback to the previous version:

```bash
# List previous task definition revisions
aws ecs list-task-definitions \
  --family-prefix bsim-ssim \
  --sort DESC \
  --region ca-central-1

# Update service to use previous revision (e.g., bsim-ssim:5)
aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-ssim-service \
  --task-definition bsim-ssim:5 \
  --region ca-central-1
```

---

## Contact

For questions about this deployment:
- **SSIM Repository:** https://github.com/jordancrombie/ssim
- **Changelog:** See `CHANGELOG.md` in the repository
