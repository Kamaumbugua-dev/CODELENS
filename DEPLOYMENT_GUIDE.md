# CodeLens Deployment Guide

## Step 1: Push Everything to GitHub

```bash
git init
git add .
git commit -m "Initial commit - CodeLens"
git remote add origin https://github.com/YOUR_USERNAME/codelens.git
git push -u origin main
```

---

## Step 2: Deploy Backend on Render

### From the Dashboard

1. Go to **[render.com](https://render.com)** and sign up / log in with GitHub
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure the service:
   - **Root Directory**: leave empty (backend files are in repo root)
   - **Runtime**: Python
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python start.py`

### Set Environment Variables

In your Render service → **Environment** tab, add:

```
GROQ_API_KEY        = your_groq_api_key_here
JWT_SECRET_KEY      = a_long_random_secret_string
GITHUB_CLIENT_ID    = Ov23liSf474UB92P0u0i
GITHUB_CLIENT_SECRET = your_github_oauth_app_secret
```

### Get Your Public URL

Render auto-generates a URL like: `https://codelens-8i03.onrender.com`

**Save this URL** — it's already set in `.env` and `.env.production`.

### Verify It's Working

Visit `https://codelens-8i03.onrender.com/health` — you should see:
```json
{"status": "ok", "service": "CodeLens API"}
```

---

## Step 3: Deploy Frontend on Vercel

1. Go to **[vercel.com](https://vercel.com)** and sign up / log in with GitHub
2. Click **"Add New"** → **"Project"**
3. Import your GitHub repository
4. Set the **Root Directory** to `codelens`
5. Vercel auto-detects Vite:
   - Build Command: `npm run build`
   - Output Directory: `dist`
6. Under **Environment Variables**, add:
   ```
   VITE_API_BASE               = https://codelens-8i03.onrender.com
   VITE_GOOGLE_CLIENT_ID       = 913580598688-ujaj6vn50p46802mf02ongfhn74sdbmk.apps.googleusercontent.com
   VITE_GITHUB_CLIENT_ID       = Ov23liSf474UB92P0u0i
   ```
7. Click **"Deploy"**

### Deploy via CLI

```bash
npm install -g vercel
cd codelens
vercel --prod
```

---

## Step 4: Configure OAuth Providers

### Google Cloud Console
- Go to **APIs & Services → Credentials → your OAuth client**
- Add to **Authorized JavaScript Origins**:
  - `http://localhost:5173`
  - `https://codelens-new.vercel.app`

### GitHub OAuth App
- Go to **GitHub → Settings → Developer settings → OAuth Apps**
- Set **Homepage URL**: `https://codelens-new.vercel.app`
- Set **Authorization callback URL**: `https://codelens-new.vercel.app`

---

## Step 5: Verify End-to-End

1. Open `https://codelens-new.vercel.app`
2. Sign in with GitHub or Google
3. Paste some code and click **"Analyze"**
4. You should see results from the Render backend

---

## Troubleshooting

### CORS errors
The backend has `allow_origins=["*"]`. To lock it down:
```python
allow_origins=["https://codelens-new.vercel.app"]
```

### Render deploy fails
- Check `requirements.txt` is in repo root
- Check logs: Render Dashboard → your service → **Logs** tab

### Vercel build fails
- Confirm `codelens/package.json` has a `build` script
- Check build logs in Vercel Dashboard

### API calls failing
- Verify `VITE_API_BASE` points to your Render URL (with `https://`)
- Check Render logs for errors
- Verify all environment variables are set on Render

---

## Cost

- **Render**: Free tier — service sleeps after 15 min inactivity, wakes on request
- **Vercel**: Hobby plan is free — unlimited deployments
- **Groq API**: Free tier available

---

## Quick Reference

| Service  | Platform | URL                                      |
|----------|----------|------------------------------------------|
| Backend  | Render   | `https://codelens-8i03.onrender.com`     |
| Frontend | Vercel   | `https://codelens-new.vercel.app`        |
| API Docs | Render   | `https://codelens-8i03.onrender.com/docs`|
