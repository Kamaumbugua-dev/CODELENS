# CodeLens Deployment Guide

## Step 1: Push Everything to GitHub

Before deploying either service, you need your code on GitHub.

```bash
# Create a new repo on github.com, then:
mkdir codelens && cd codelens

# Create two directories
mkdir backend frontend

# Copy backend files into backend/
# Copy frontend React app into frontend/

git init
git add .
git commit -m "Initial commit - CodeLens"
git remote add origin https://github.com/YOUR_USERNAME/codelens.git
git push -u origin main
```

---

## Step 2: Deploy Backend on Railway

### Option A: From the Dashboard (Easiest)

1. Go to **[railway.com](https://railway.com)** and sign up / log in with GitHub
2. Click **"New Project"**
3. Select **"Deploy from GitHub Repo"**
4. Pick your `codelens` repository
5. Railway will ask which directory — set the **Root Directory** to `backend`
6. Railway auto-detects Python and installs dependencies from `requirements.txt`

### Set Environment Variables

7. In your Railway service, go to the **Variables** tab
8. Add your API key:
   ```
   ANTHROPIC_API_KEY = sk-ant-your-key-here
   ```

### Generate a Public URL

9. Go to **Settings → Networking**
10. Click **"Generate Domain"**
11. You'll get a URL like: `codelens-backend-production.up.railway.app`
12. **Save this URL** — you'll need it for the frontend

### Option B: Using the CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Navigate to backend directory
cd backend

# Create a new project
railway init

# Link to your project
railway link

# Set environment variable
railway variables set ANTHROPIC_API_KEY=sk-ant-your-key-here

# Deploy
railway up

# Generate a public domain
railway domain
```

### Verify It's Working

Visit `https://YOUR-RAILWAY-URL/health` — you should see:
```json
{"status": "ok", "service": "CodeLens API"}
```

---

## Step 3: Deploy Frontend on Vercel

### First: Set Up the React Project Locally

The artifact JSX file needs to be wrapped in a Vite React project:

```bash
# Create a Vite React project
npm create vite@latest codelens-frontend -- --template react
cd codelens-frontend

# Install dependencies
npm install

# Replace src/App.jsx with the CodeLens component
# Copy codelens-app.jsx content into src/App.jsx

# IMPORTANT: Update the API_BASE URL in App.jsx
# Change: const API_BASE = "http://localhost:8000";
# To:     const API_BASE = "https://YOUR-RAILWAY-URL";
```

### Create Environment Config (Optional but Recommended)

Create a `.env` file in the frontend root:
```
VITE_API_BASE=https://codelens-backend-production.up.railway.app
```

Then in your App.jsx, update:
```javascript
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
```

### Option A: Deploy from Dashboard (Easiest)

1. Go to **[vercel.com](https://vercel.com)** and sign up / log in with GitHub
2. Click **"Add New" → "Project"**
3. Import your GitHub repository
4. Set the **Root Directory** to `frontend` (if using a monorepo)
5. Vercel auto-detects Vite and sets build settings:
   - Build Command: `npm run build`
   - Output Directory: `dist`
6. Under **Environment Variables**, add:
   ```
   VITE_API_BASE = https://YOUR-RAILWAY-URL
   ```
7. Click **"Deploy"**
8. Done! You'll get a URL like: `codelens.vercel.app`

### Option B: Deploy via CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Navigate to frontend directory
cd codelens-frontend

# Deploy (follow the prompts)
vercel

# For production deployment
vercel --prod
```

### Add Custom Domain (Optional)

In Vercel Dashboard → Project → Settings → Domains, you can add a custom domain.

---

## Step 4: Verify End-to-End

1. Open your Vercel URL (e.g., `codelens.vercel.app`)
2. Paste some code in the editor
3. Click **"Analyze Code"**
4. You should see the analysis results from your Railway backend

---

## Troubleshooting

### CORS errors in browser console
The backend already has `allow_origins=["*"]` — but if you want to lock it down:
```python
allow_origins=["https://codelens.vercel.app"]
```

### Railway deploy fails
- Check that `requirements.txt` is in the root of your backend directory
- Make sure `railway.json` and `Procfile` are present
- Check logs: Railway Dashboard → your service → "Deployments" → click latest → "View Logs"

### Vercel build fails
- Make sure `package.json` exists with build script
- Check that all imports resolve (no missing packages)
- Check build logs in Vercel Dashboard

### API calls failing after deploy
- Verify the `API_BASE` URL points to your Railway domain (with `https://`)
- Check Railway logs for errors
- Verify `ANTHROPIC_API_KEY` is set in Railway environment variables

---

## Cost

- **Railway**: Free tier gives you $5/month credit — more than enough for a hackathon demo
- **Vercel**: Hobby plan is free — unlimited deployments for personal projects
- **Anthropic API**: Pay-per-use, a full demo session costs pennies

---

## Quick Reference

| Service  | Platform | URL Pattern                          |
|----------|----------|--------------------------------------|
| Backend  | Railway  | `*.up.railway.app`                   |
| Frontend | Vercel   | `*.vercel.app`                       |
| API Docs | Railway  | `YOUR-RAILWAY-URL/docs` (auto-generated by FastAPI) |
