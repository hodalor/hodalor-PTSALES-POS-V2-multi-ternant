# Backend Deployment: Render + Cloud Run

This backend can now run in both `Render` and `Google Cloud Run` from the same codebase.

## What was added

- `Dockerfile`
- `.dockerignore`
- `cloudbuild.yaml`
- `cloudrun.service.yaml`
- `cloudrun.env.example.yaml`
- `/healthz` and `/readyz` endpoints

Render can continue using `render.yaml` and `npm start`.
Cloud Run uses the container image built from `Dockerfile`.

## Shared environment variables

Set the same backend environment values in both Render and Cloud Run so either platform can serve as fallback.

Required minimum:

- `NODE_ENV=production`
- `MONGODB_URI=...`
- `JWT_SECRET=...`

Recommended:

- `MONGODB_MASTER_DB=master`
- `RENEWAL_PAYMENT_REDIRECT_URL=...`
- `TENANT_LIMIT_PAYMENT_REDIRECT_URL=...`
- `SMTP_HOST=...`
- `SMTP_PORT=587`
- `SMTP_SECURE=false`
- `SMTP_USER=...`
- `SMTP_PASS=...`
- `SMTP_FROM=...`
- `PT_AI_API_KEY=...`
- `PT_AI_BASE_URL=...`
- `PT_AI_MODEL=...`
- `PT_AI_TRANSCRIBE_MODEL=...`
- `PAYSTACK_API_BASE=...`
- `PAYSTACK_PUBLIC_KEY=...`
- `PAYSTACK_SECRET_KEY=...`
- `PAYPAL_MODE=...`
- `PAYPAL_API_BASE=...`
- `PAYPAL_CLIENT_ID=...`
- `PAYPAL_CLIENT_SECRET=...`
- `DPO_API_URL=...`
- `DPO_PAYMENT_URL=...`
- `DPO_COMPANY_TOKEN=...`
- `DPO_SERVICE_TYPE=...`
- `DPO_PTL=15`
- `GCS_PROJECT_ID=...`
- `GCS_BUCKET_NAME=...`
- `GCS_CLIENT_EMAIL=...`
- `GCS_PRIVATE_KEY=...`
- `GCS_PUBLIC_BASE_URL=...`

Cloud Run will inject `PORT=8080` automatically. Render injects its own `PORT`. The backend already supports both.

## Build locally

From the `backend` folder:

```bash
docker build -t ptsales-backend .
docker run --env-file .env -p 8080:8080 ptsales-backend
```

Health checks:

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

## Cloud Run quick deploy

1. Create an Artifact Registry repository if you do not already have one:

```bash
gcloud artifacts repositories create ptsales-backend \
  --repository-format=docker \
  --location=REGION
```

2. Submit the backend build from the `backend` folder:

```bash
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions _SERVICE=ptsales-backend,_REGION=REGION,_REPOSITORY=ptsales-backend
```

3. Set environment variables on the Cloud Run service:

```bash
gcloud run services update ptsales-backend \
  --region=REGION \
  --update-env-vars NODE_ENV=production,MONGODB_URI=YOUR_MONGODB_URI,JWT_SECRET=YOUR_JWT_SECRET
```

For large secrets like `GCS_PRIVATE_KEY`, prefer Cloud Run secrets or `--env-vars-file`.

You can also copy `cloudrun.env.example.yaml`, fill in your real values, and run:

```bash
gcloud run services update ptsales-backend \
  --region=REGION \
  --env-vars-file cloudrun.env.yaml
```

## Cloud Run service YAML option

Edit placeholders in `cloudrun.service.yaml` and deploy:

```bash
gcloud run services replace cloudrun.service.yaml --region=REGION
```

After that, update the sensitive env vars in Cloud Run or Secret Manager.

## Render

No Render deployment flow was removed. Keep using:

- `render.yaml`
- `buildCommand: npm install`
- `startCommand: npm start`

Set the same environment values in Render that you use in Cloud Run.

## Fallback strategy

To use Render and Cloud Run as operational fallback:

1. Keep both services on the same backend release.
2. Keep both services pointed at the same production MongoDB cluster.
3. Keep the same secrets and payment configuration in both places.
4. Point your frontend or DNS/proxy layer to the active backend.
5. If one host has trouble, switch traffic to the other without changing app code.

## Notes

- The backend is stateless, so dual-host fallback is mainly about keeping env vars and MongoDB identical.
- Media storage is already environment-driven, so the same GCS config can be reused in both Render and Cloud Run.
