# Heroku Deployment Guide

## Prerequisites

- Heroku CLI installed (✓ already installed)
- Git repository initialized (✓ already done)

## Step-by-Step Deployment Commands

### 1. Commit the Procfile (if not already committed)

```bash
git add Procfile
git commit -m "Add Procfile for Heroku deployment"
```

### 2. Login to Heroku

```bash
heroku login
```

This will open a browser window for authentication. Follow the prompts.

### 3. Create Heroku App in EU Region

```bash
heroku create fts-sports-trading-server --region eu
```

### 4. Set Environment Variables

You'll need to set your MongoDB connection string and any other required environment variables:

```bash
# Set MongoDB URI (replace with your actual MongoDB connection string)
heroku config:set MONGODB_URI="your-mongodb-connection-string"

# Optional: Set if you want to run initial sync on server start
heroku config:set RUN_INITIAL_SYNC="false"
```

**Note:** For the Google Sheets service account credentials, set each field as a separate environment variable:

```bash
# Set Google Service Account credentials (replace with your actual values)
heroku config:set GOOGLE_SERVICE_ACCOUNT_TYPE="service_account"
heroku config:set GOOGLE_SERVICE_ACCOUNT_PROJECT_ID="your-project-id"
heroku config:set GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID="your-private-key-id"
heroku config:set GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL="your-service-account@project.iam.gserviceaccount.com"
heroku config:set GOOGLE_SERVICE_ACCOUNT_CLIENT_ID="your-client-id"

# For the private key, use single quotes to preserve newlines, or escape them
# Option 1: Use single quotes (recommended)
heroku config:set GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\nYOUR_KEY_CONTENT\n-----END PRIVATE KEY-----'

# Option 2: Use double quotes with escaped newlines
heroku config:set GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nYOUR_KEY_CONTENT\\n-----END PRIVATE KEY-----"

# Optional: Set other Google auth URIs (defaults are provided)
heroku config:set GOOGLE_SERVICE_ACCOUNT_AUTH_URI="https://accounts.google.com/o/oauth2/auth"
heroku config:set GOOGLE_SERVICE_ACCOUNT_TOKEN_URI="https://oauth2.googleapis.com/token"
heroku config:set GOOGLE_SERVICE_ACCOUNT_AUTH_PROVIDER_X509_CERT_URL="https://www.googleapis.com/oauth2/v1/certs"
heroku config:set GOOGLE_SERVICE_ACCOUNT_CLIENT_X509_CERT_URL="https://www.googleapis.com/robot/v1/metadata/x509/YOUR_SERVICE_ACCOUNT"
heroku config:set GOOGLE_SERVICE_ACCOUNT_UNIVERSE_DOMAIN="googleapis.com"
```

**Important:** When setting the private key:

- The private key should include the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` markers
- Use `\n` to represent newlines in the key
- Do NOT wrap the entire value in quotes when using the Heroku CLI (the CLI handles quotes automatically)
- If copying from a JSON file, ensure all `\n` sequences are preserved

### 5. Deploy to Heroku

```bash
git push heroku main
```

### 6. Verify Deployment

```bash
# Check app status
heroku ps

# View logs
heroku logs --tail

# Open the app in browser
heroku open
```

## Important Notes

1. **MongoDB**: Make sure your MongoDB database is accessible from Heroku (if using MongoDB Atlas, whitelist Heroku's IP ranges or use 0.0.0.0/0)

2. **Service Account Key**: The `service-account-key.json` file is in `.gitignore`. You'll need to either:

   - Store it as a config var and modify `googleSheetsService.js` to read from environment
   - Or use a different authentication method

3. **Port**: Heroku automatically sets the `PORT` environment variable, so your server will use it correctly.

4. **Database Connection**: Ensure your MongoDB URI is correct and the database is accessible from Heroku's servers.

## Quick Command Summary

```bash
# 1. Commit Procfile
git add Procfile && git commit -m "Add Procfile for Heroku deployment"

# 2. Login
heroku login

# 3. Create app
heroku create fts-sports-trading-server --region eu

# 4. Set config vars
heroku config:set MONGODB_URI="your-mongodb-uri"

# 5. Deploy
git push heroku main

# 6. Check status
heroku logs --tail
```
