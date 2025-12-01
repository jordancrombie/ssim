# AWS Deployment Guide - SSIM Store Simulator

SSIM is deployed to AWS as part of the BSIM (Banking Simulator) infrastructure, running on ECS Fargate behind the shared Application Load Balancer.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                AWS Cloud (ca-central-1)                       │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                 Application Load Balancer (bsim-alb)                   │  │
│  │                   with AWS Certificate Manager                         │  │
│  │            Routes: ssim.banksim.ca → bsim-ssim-tg:3005                │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                       │                                      │
│                            ┌──────────▼───────────┐                          │
│                            │     SSIM Service     │                          │
│                            │    ECS Fargate       │                          │
│                            │    Port 3005         │                          │
│                            └──────────────────────┘                          │
│                                                                               │
│  Related BSIM Services (same ALB):                                           │
│  ┌─────────┐ ┌─────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐            │
│  │Frontend │ │ Admin   │ │Auth Server│ │OpenBanking│ │ Backend │            │
│  │ :3000   │ │ :3002   │ │  :3003    │ │  :3004    │ │  :3001  │            │
│  └─────────┘ └─────────┘ └───────────┘ └───────────┘ └─────────┘            │
└──────────────────────────────────────────────────────────────────────────────┘
```

## AWS Resources

### ECR Repository
- **Repository Name:** `bsim/ssim`
- **Repository URI:** `301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/ssim`
- **Image Scanning:** Enabled (scanOnPush)

### ECS Configuration
- **Cluster:** `bsim-cluster`
- **Service:** `bsim-ssim-service`
- **Task Definition:** `bsim-ssim`
- **CPU:** 0.5 vCPU (512 units)
- **Memory:** 1 GB (1024 MB)
- **Launch Type:** Fargate
- **Platform Version:** 1.4.0

### Networking
- **Subnets:** Public subnets (ca-central-1a, ca-central-1b)
- **Security Group:** `sg-06aaaf996187d82fc` (bsim-ecs-sg)
- **Port:** 3005
- **Public IP:** Enabled (required for ECR image pull)

### Load Balancer
- **ALB:** `bsim-alb`
- **Target Group:** `bsim-ssim-tg`
- **Health Check:** `/health`
- **Listener Rule:** Priority 5, Host: `ssim.banksim.ca`

### DNS
- **Domain:** `ssim.banksim.ca`
- **Hosted Zone:** `Z00354511TXC0NR2LH3WH`
- **Record Type:** A (Alias to ALB)

### Logging
- **CloudWatch Log Group:** `/ecs/bsim-ssim`

## Environment Variables

The ECS task is configured with these environment variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `PORT` | `3005` | Server port |
| `SESSION_SECRET` | `<secret>` | Express session secret |
| `TRUST_PROXY` | `true` | Trust ALB proxy headers |
| `APP_BASE_URL` | `https://ssim.banksim.ca` | Application base URL |
| `OPENBANKING_API_URL` | `https://openbanking.banksim.ca` | BSIM Open Banking API |
| `OIDC_PROVIDERS` | `<json>` | OIDC provider configuration |

### OIDC Provider Configuration

```json
[{
  "id": "bsim",
  "name": "BSIM Bank",
  "issuer": "https://auth.banksim.ca",
  "clientId": "ssim-client",
  "clientSecret": "<client-secret>",
  "scopes": "openid profile email fdx:accountdetailed:read fdx:transactions:read"
}]
```

**Note:** The OAuth client must be registered in the BSIM auth server with:
- **Client ID:** `ssim-client`
- **Redirect URI:** `https://ssim.banksim.ca/auth/callback/bsim`
- **Grant Types:** `authorization_code`, `refresh_token`
- **Scopes:** `openid profile email fdx:accountdetailed:read fdx:transactions:read`

## Deployment Commands

### Build and Push Docker Image

```bash
# Login to ECR
aws ecr get-login-password --region ca-central-1 | \
  docker login --username AWS --password-stdin 301868770392.dkr.ecr.ca-central-1.amazonaws.com

# Build for AMD64 (required for Fargate)
docker build --platform linux/amd64 -t bsim/ssim .

# Tag and push
docker tag bsim/ssim:latest 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/ssim:latest
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/bsim/ssim:latest
```

### Force New Deployment

```bash
aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-ssim-service \
  --force-new-deployment \
  --region ca-central-1
```

### View Logs

```bash
aws logs tail /ecs/bsim-ssim --follow --region ca-central-1
```

### Check Service Status

```bash
aws ecs describe-services \
  --cluster bsim-cluster \
  --services bsim-ssim-service \
  --region ca-central-1 \
  --query 'services[0].{status:status,runningCount:runningCount,desiredCount:desiredCount}'
```

### Check Target Health

```bash
aws elbv2 describe-target-health \
  --target-group-arn "arn:aws:elasticloadbalancing:ca-central-1:301868770392:targetgroup/bsim-ssim-tg/a17ef9b308bb207e" \
  --region ca-central-1
```

## Task Definition

The task definition is stored in `ssim-task-definition.json`. To update:

```bash
# Register new task definition
aws ecs register-task-definition \
  --cli-input-json file://ssim-task-definition.json \
  --region ca-central-1

# Update service to use new task definition
aws ecs update-service \
  --cluster bsim-cluster \
  --service bsim-ssim-service \
  --task-definition bsim-ssim \
  --region ca-central-1
```

## Cost Estimate

SSIM adds approximately **$8-15/month** to the BSIM infrastructure:
- ECS Fargate (1 task, 0.5 vCPU, 1GB): ~$8-12/month
- CloudWatch Logs: ~$1-3/month
- ECR Storage: < $1/month

## Troubleshooting

### Task Not Starting
1. Check CloudWatch logs: `aws logs tail /ecs/bsim-ssim --region ca-central-1`
2. Verify security group allows ALB traffic on port 3005
3. Ensure subnets have internet access (public IP or NAT gateway)

### Health Check Failing
1. Verify `/health` endpoint returns 200 OK
2. Check target group health: see command above
3. Review CloudWatch logs for application errors

### OIDC Authentication Issues
1. Verify OAuth client is registered in BSIM auth server
2. Check redirect URI matches exactly: `https://ssim.banksim.ca/auth/callback/bsim`
3. Ensure client secret in task definition matches auth server

## Related Documentation

- **BSIM Project:** https://github.com/jordancrombie/bsim
- **BSIM AWS Deployment:** See `AWS_DEPLOYMENT.md` in BSIM repo
- **SSIM README:** See `README.md` in this repo
