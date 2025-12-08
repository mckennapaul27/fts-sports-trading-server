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

**Note:** For the Google Sheets service account key, you have two options:

- Option A: Store the JSON content as an environment variable and modify the code to read from env var instead of file
- Option B: Use Heroku's config vars to store the key file content

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
