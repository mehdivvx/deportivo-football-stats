# Deportivo de Jauhar — Supabase + Vercel

This version saves all edits to Supabase, including Base64 pictures. The secret key is used only by server.js. The browser calls your own /api routes. Keep RLS enabled; do not add public write policies.

## 1. Preserve existing edits
Before uploading, copy your CURRENT local data.json into this folder if you have already edited stats or photos. Do this before the first deployment. This file seeds the database only if the main row does not exist. Later deployments never overwrite saved database data.

## 2. Database
You have already run this schema. Do not rerun CREATE TABLE if it exists:

```sql
CREATE TABLE public.community_data (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  document JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.community_data ENABLE ROW LEVEL SECURITY;
```

The table must be accessible to Supabase's Data API (public schema). The backend uses a secret key or legacy service_role key and bypasses RLS. No anonymous policies are needed. No Supabase Storage bucket is needed for these compressed pictures.

## 3. GitHub
Create a private repository named deportivo-de-jauhar. Upload the EXTRACTED files, preserving public/index.html inside public/. Put package.json, server.js, data.json and vercel.json at the repository root. Do not upload the ZIP, node_modules, .env or secret keys. Commit the upload.

## 4. Vercel
Add New > Project > import the GitHub repository. The framework should be Express. Leave the root directory at the repository root and leave build/output overrides unset.

Add these environment variables, using your actual values:

| Name | Value |
| --- | --- |
| SUPABASE_URL | Your project's base URL from Connect, starting https:// and ending .supabase.co; omit /rest/v1 |
| SUPABASE_SECRET_KEY | Your sb_secret_ key or legacy service_role key |
| ADMIN_PASSWORD | A private, strong password you choose for dashboard login |

Do not prefix these names with NEXT_PUBLIC or VITE. Enable them for Production (and Preview only if you want preview deployments to share the same database). Click Deploy. If adding or changing environment values after deployment, redeploy.

## 5. Verify
Visit the deployed URL. The first API request seeds the main database row if empty. Log in with ADMIN_PASSWORD, edit one statistic and Save Changes Forever. Open the URL in a private browser window and verify the saved statistic is visible. The table should have one row with id main. Restarting or redeploying the app does not reset this row.

## Local use (PowerShell)
Set SUPABASE_URL, SUPABASE_SECRET_KEY and ADMIN_PASSWORD as environment variables in your terminal before running npm.cmd install and npm.cmd start. Node 22 or newer is required. Environment files are not loaded automatically. Never commit credentials.

## Limits and troubleshooting
- Total JSON saves must remain below 4 MB to fit Vercel's function request limit. Images are compressed to 150 x 150. Prefer direct image URLs if the dataset becomes large.
- Initial pictures are empty. Upload club crests and player photos from Admin mode.
- A 503 setup message means required environment variables are missing, or the Supabase connection/table is unavailable. Check Vercel logs without sharing secrets.
- A 409 means another editor saved first. Copy any unsaved changes you want to keep, reload, then reapply them.
- The login limiter is per running server instance; it is not a distributed protection service.
- Supabase's free plan may pause for low activity; resume it in its dashboard if needed. Hosting/database quotas still apply.
- The admin password is kept in browser memory only. Refreshing requires login again.
- This package has been checked locally against a simulated Supabase REST service, not your live project. Verify the live save after deployment.
