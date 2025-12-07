# AWS Deployment Guide

This guide covers deploying SSIM to AWS ECS Fargate. It's designed for developers who want to deploy their own instance of SSIM.

> **For BSIM Team:** See [SSIM-Production-Deployment-v1.8.md](SSIM-Production-Deployment-v1.8.md) for production-specific instructions.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              AWS Cloud                                        │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │              Application Load Balancer (ALB)                           │  │
│  │                with AWS Certificate Manager                            │  │
│  │           Routes: your-domain.com → target-group:3005                  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                       │                                      │
│                            ┌──────────▼───────────┐                          │
│                            │     SSIM Service     │                          │
│                            │    ECS Fargate       │                          │
│                            │    Port 3005         │                          │
│                            └──────────────────────┘                          │
│                                                                               │
│  External Dependencies:                                                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                            │
│  │ OIDC Provider│ │ Payment API │ │ Wallet API  │                            │
│  │  (Auth)     │ │   (NSIM)    │ │   (WSIM)    │                            │
│  └─────────────┘ └─────────────┘ └─────────────┘                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured
- Docker installed locally
- An OIDC provider for authentication
- (Optional) Payment API endpoint (NSIM)
- (Optional) Wallet API endpoint (WSIM)

## Step 1: Create ECR Repository

```bash
# Create ECR repository
aws ecr create-repository \
  --repository-name your-org/ssim \
  --image-scanning-configuration scanOnPush=true \
  --region your-region

# Note the repository URI for later
# Example: 123456789012.dkr.ecr.us-east-1.amazonaws.com/your-org/ssim
```

## Step 2: Build and Push Docker Image

```bash
# Login to ECR
aws ecr get-login-password --region your-region | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.your-region.amazonaws.com

# Build for AMD64 (required for Fargate)
# Important: Use --platform linux/amd64 if building on ARM/Apple Silicon
docker buildx build --platform linux/amd64 -t ssim:latest --load .

# Tag for ECR
docker tag ssim:latest 123456789012.dkr.ecr.your-region.amazonaws.com/your-org/ssim:latest

# Push to ECR
docker push 123456789012.dkr.ecr.your-region.amazonaws.com/your-org/ssim:latest
```

## Step 3: Create ECS Task Definition

Create a file `ssim-task-definition.json`:

```json
{
  "family": "ssim",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "ssim",
      "image": "123456789012.dkr.ecr.your-region.amazonaws.com/your-org/ssim:latest",
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
        { "name": "SESSION_SECRET", "value": "your-secure-random-string" },
        { "name": "TRUST_PROXY", "value": "true" },
        { "name": "APP_BASE_URL", "value": "https://your-domain.com" },
        { "name": "OIDC_PROVIDERS", "value": "[{\"id\":\"provider\",\"name\":\"Your Provider\",\"issuer\":\"https://auth.example.com\",\"clientId\":\"your-client-id\",\"clientSecret\":\"your-client-secret\",\"scopes\":\"openid profile email\"}]" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/ssim",
          "awslogs-region": "your-region",
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

Register the task definition:

```bash
aws ecs register-task-definition \
  --cli-input-json file://ssim-task-definition.json \
  --region your-region
```

## Step 4: Create ECS Cluster and Service

```bash
# Create cluster (if not exists)
aws ecs create-cluster --cluster-name your-cluster --region your-region

# Create CloudWatch log group
aws logs create-log-group --log-group-name /ecs/ssim --region your-region

# Create service
aws ecs create-service \
  --cluster your-cluster \
  --service-name ssim-service \
  --task-definition ssim \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-zzz],assignPublicIp=ENABLED}" \
  --region your-region
```

## Step 5: Set Up Load Balancer

1. **Create Target Group:**
   - Target type: IP
   - Protocol: HTTP
   - Port: 3005
   - Health check path: `/health`

2. **Create/Update ALB Listener Rule:**
   - Host header: `your-domain.com`
   - Forward to: your target group

3. **Update ECS Service** to use the load balancer:
```bash
aws ecs update-service \
  --cluster your-cluster \
  --service ssim-service \
  --load-balancers targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=ssim,containerPort=3005 \
  --region your-region
```

## Environment Variables Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port | `3005` |
| `SESSION_SECRET` | Express session secret (generate with `openssl rand -base64 32`) | `abc123...` |
| `TRUST_PROXY` | Trust proxy headers (required behind ALB) | `true` |
| `APP_BASE_URL` | Public URL of your SSIM instance | `https://store.example.com` |
| `OIDC_PROVIDERS` | JSON array of OIDC provider configs | See below |

### OIDC Provider Configuration

```json
[{
  "id": "provider-id",
  "name": "Display Name",
  "issuer": "https://auth.example.com",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "scopes": "openid profile email"
}]
```

### Payment Integration (Optional)

| Variable | Description | Example |
|----------|-------------|---------|
| `PAYMENT_API_URL` | Payment API endpoint | `https://payment.example.com` |
| `PAYMENT_AUTH_URL` | Auth URL for payment OAuth | `https://auth.example.com` |
| `PAYMENT_CLIENT_ID` | OAuth client ID for payments | `ssim-client` |
| `PAYMENT_CLIENT_SECRET` | OAuth client secret | `secret` |
| `MERCHANT_ID` | Your merchant identifier | `ssim-merchant` |
| `WEBHOOK_SECRET` | HMAC secret for webhooks | `webhook-secret` |

### Wallet Integration (Optional)

| Variable | Description | Example |
|----------|-------------|---------|
| `WSIM_ENABLED` | Enable wallet payments | `true` |
| `WSIM_AUTH_URL` | Wallet auth server URL | `https://wallet-auth.example.com` |
| `WSIM_CLIENT_ID` | OAuth client ID for wallet | `ssim-merchant` |
| `WSIM_CLIENT_SECRET` | OAuth client secret | `secret` |
| `WSIM_POPUP_URL` | Wallet popup URL | `https://wallet-auth.example.com` |
| `WSIM_API_KEY` | Wallet Merchant API key | `wsim_api_xxx` |
| `WSIM_API_URL` | Wallet Merchant API endpoint | `https://wallet.example.com/api/merchant` |

### Admin Dashboard (Optional)

| Variable | Description | Example |
|----------|-------------|---------|
| `ADMIN_ENABLED` | Enable admin dashboard | `true` |
| `ADMIN_EMAILS` | Comma-separated admin emails | `admin@example.com` |

## Deployment Commands

### Force New Deployment

After pushing a new image:

```bash
aws ecs update-service \
  --cluster your-cluster \
  --service ssim-service \
  --force-new-deployment \
  --region your-region
```

### View Logs

```bash
aws logs tail /ecs/ssim --follow --region your-region
```

### Check Service Status

```bash
aws ecs describe-services \
  --cluster your-cluster \
  --services ssim-service \
  --region your-region \
  --query 'services[0].{status:status,running:runningCount,desired:desiredCount}'
```

### Check Target Health

```bash
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:your-region:123456789012:targetgroup/your-tg/xxx \
  --region your-region
```

## Troubleshooting

### Task Not Starting

1. **Check CloudWatch logs:**
   ```bash
   aws logs tail /ecs/ssim --region your-region
   ```

2. **Verify security group** allows traffic on port 3005 from ALB

3. **Ensure subnets have internet access** (public IP or NAT gateway required for ECR image pull)

### Health Check Failing

1. **Verify `/health` endpoint** returns HTTP 200:
   ```bash
   curl https://your-domain.com/health
   ```

2. **Check target group health** (see command above)

3. **Review application logs** for startup errors

### OIDC Authentication Issues

1. **Verify OAuth client registration** in your identity provider

2. **Check redirect URI** matches exactly:
   ```
   https://your-domain.com/auth/callback/provider-id
   ```

3. **Ensure client secret** in task definition matches auth server

### Session Issues Behind Load Balancer

If you see "Invalid session state" errors:

1. Ensure `TRUST_PROXY=true` is set
2. Verify ALB is forwarding `X-Forwarded-*` headers
3. Check session cookie settings are compatible with your domain

## Cost Estimate

Approximate monthly costs for a basic SSIM deployment:

| Resource | Specification | Estimated Cost |
|----------|---------------|----------------|
| ECS Fargate | 1 task, 0.5 vCPU, 1GB RAM | $8-12/month |
| Application Load Balancer | Shared or dedicated | $16-25/month |
| CloudWatch Logs | Basic logging | $1-3/month |
| ECR Storage | < 1GB | < $1/month |
| **Total** | | **$25-40/month** |

*Costs vary by region and usage. Use AWS Pricing Calculator for accurate estimates.*

## Security Considerations

1. **Never commit secrets** - Use AWS Secrets Manager or Parameter Store for sensitive values
2. **Use HTTPS** - Configure SSL certificate via ACM
3. **Restrict security groups** - Only allow necessary traffic
4. **Enable image scanning** - ECR can scan for vulnerabilities
5. **Rotate secrets regularly** - Update session secrets and API keys periodically

## Related Documentation

- [README.md](../README.md) - Project overview and local development
- [Wallet-Integration-Guide.md](Wallet-Integration-Guide.md) - Detailed wallet payment integration
- [WSIM-API-Integration-Plan.md](WSIM-API-Integration-Plan.md) - WSIM Merchant API reference
