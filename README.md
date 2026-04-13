# 🎬 YouTube AI Automation — 100% Free Cloud Deployment Guide

Zero cost. Zero RAM on your machine. Fully automated.

---

## 📐 Architecture

```
Your PC        → Nothing running (0 RAM used)
                              │
         ┌────────────────────▼────────────────────┐
         │           RAILWAY (Free)                 │
         │  ┌─────────────┐  ┌──────────────────┐  │
         │  │  API Server  │  │  Worker Process  │  │
         │  │  Express.js  │  │  9 BullMQ workers│  │
         │  │  Scheduler   │  │  FFmpeg assembly │  │
         │  └──────┬───────┘  └────────┬─────────┘  │
         └─────────┼──────────────────┼─────────────┘
                   │                  │
    ┌──────────────┼──────────────────┼──────────────┐
    │              ▼                  ▼              │
    │  ┌─────────────────┐  ┌──────────────────┐    │
    │  │  MongoDB Atlas   │  │  Upstash Redis   │    │
    │  │  (Free 512MB)    │  │  (Free queues)   │    │
    │  └─────────────────┘  └──────────────────┘    │
    │                                                │
    │  ┌─────────────┐  ┌──────────────────────┐    │
    │  │  Groq API   │  │  HuggingFace API     │    │
    │  │  (Free LLM) │  │  (Free TTS/Whisper)  │    │
    │  └─────────────┘  └──────────────────────┘    │
    │                                                │
    │  ┌──────────────────────────────────────────┐  │
    │  │  Cloudflare R2  (Free 10GB storage)      │  │
    │  │  Stores: voice.wav, video.mp4, thumbs    │  │
    │  └──────────────────────────────────────────┘  │
    └────────────────────────────────────────────────┘
```

---

## ✅ Free Tier Limits (all permanent, no expiry)

| Service | Free Limit | Enough for... |
|---|---|---|
| Railway | 500 hrs/month, 512MB RAM | ~2 videos/day |
| MongoDB Atlas | 512MB storage | 10,000+ video records |
| Upstash Redis | 10,000 req/day | Full pipeline daily |
| Groq API | 14,400 req/day, 30 req/min | Unlimited scripts |
| HuggingFace | 30,000 calls/month | ~1,000 TTS calls |
| Cloudflare R2 | 10GB storage, 1M ops/month | ~50 videos stored |
| Pexels | Unlimited | Unlimited images |
| Pixabay | Unlimited | Unlimited images |
| YouTube API | 10,000 units/day | 6 uploads/day |

---

## 🚀 STEP-BY-STEP DEPLOYMENT

---

### STEP 1 — MongoDB Atlas (database)

**Time: 5 minutes**

1. Go to **https://www.mongodb.com/cloud/atlas/register**
2. Sign up with Google or email (no credit card)
3. Choose **"Free Shared"** cluster → Select any region (pick closest to you)
4. Create a database user:
   - Username: `ytai`
   - Password: generate a strong one, **save it**
5. Network Access → **Add IP Address → Allow Access from Anywhere** (`0.0.0.0/0`)
6. Click **"Connect"** → **"Connect your application"**
7. Copy the connection string — it looks like:
   ```
   mongodb+srv://ytai:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/
   ```
8. Add your database name to the end:
   ```
   mongodb+srv://ytai:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/ytai?retryWrites=true&w=majority
   ```
9. **Save this** → goes into `MONGODB_URI` env var

---

### STEP 2 — Upstash Redis (queues)

**Time: 3 minutes**

1. Go to **https://upstash.com** → Sign Up (no credit card)
2. Click **"Create Database"**
3. Name: `ytai-queues`, Region: pick closest
4. **Enable TLS** ✅ (required for BullMQ)
5. After creation, click on the database
6. Go to **"Details"** tab
7. Copy the **"Redis URL"** — looks like:
   ```
   rediss://default:YOUR_PASSWORD@YOUR_HOST.upstash.io:6379
   ```
8. **Save this** → goes into `REDIS_URL` env var

---

### STEP 3 — Groq API (free LLM — replaces Ollama)

**Time: 2 minutes**

1. Go to **https://console.groq.com**
2. Sign up with Google (no credit card ever)
3. Click **"API Keys"** → **"Create API Key"**
4. Name it `ytai`, copy the key:
   ```
   gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
5. **Save this** → goes into `GROQ_API_KEY` env var

**Models available free:**
- `llama3-8b-8192` — fast, good for scripts
- `mixtral-8x7b-32768` — best quality for SEO
- `gemma-7b-it` — alternative

---

### STEP 4 — HuggingFace (free TTS + Whisper + Image gen)

**Time: 3 minutes**

1. Go to **https://huggingface.co** → Sign Up (free)
2. Click your profile icon → **Settings → Access Tokens**
3. Click **"New token"** → Name: `ytai`, Role: **Read**
4. Copy the token:
   ```
   hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
5. **Save this** → goes into `HUGGINGFACE_API_KEY` env var

---

### STEP 5 — Cloudflare R2 (free file storage)

**Time: 10 minutes**

1. Go to **https://cloudflare.com** → Sign Up (free, no credit card for R2)
2. In dashboard sidebar → **R2 Object Storage**
3. Click **"Create bucket"** → Name: `ytai-videos` → Create
4. Go to **R2 Overview** → **"Manage R2 API Tokens"**
5. Click **"Create API token"**:
   - Token name: `ytai`
   - Permissions: **Object Read & Write**
   - Specify bucket: `ytai-videos`
6. Copy:
   - **Account ID** (shown on R2 overview page)
   - **Access Key ID**
   - **Secret Access Key**
7. Make bucket public (for video URLs):
   - Go to your bucket → **Settings → Public Access**
   - Enable **"Allow Public Access"**
   - Copy the **Public Bucket URL**: `https://pub-xxx.r2.dev`
8. **Save all** → goes into `CLOUDFLARE_*` env vars

---

### STEP 6 — Pexels + Pixabay API keys (free images)

**Pexels (2 minutes):**
1. Go to **https://www.pexels.com/api/**
2. Sign up → **"Get Started"**
3. Copy your API key

**Pixabay (2 minutes):**
1. Go to **https://pixabay.com/api/docs/**
2. Log in / Sign up → Your API key is shown on that page

---

### STEP 7 — YouTube Data API (upload credentials)

**Time: 10 minutes**

1. Go to **https://console.cloud.google.com**
2. Create a new project → name it `ytai`
3. **APIs & Services → Enable APIs → search "YouTube Data API v3" → Enable**
4. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Name: `ytai`
7. Authorized redirect URIs: add your Railway URL (fill in after Step 8):
   ```
   https://YOUR-APP.railway.app/api/auth/callback
   ```
   For now, also add: `http://localhost:3000/api/auth/callback`
8. Click Create → Copy:
   - **Client ID**: `123456-xxx.apps.googleusercontent.com`
   - **Client Secret**: `GOCSPX-xxx`
9. **OAuth consent screen**: set to **External**, fill in app name, your email, save

---

### STEP 8 — Deploy to Railway

**Time: 10 minutes**

#### 8a. Push code to GitHub

```bash
cd ytai-cloud
git init
git add .
git commit -m "Initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/ytai-cloud.git
git push -u origin main
```

#### 8b. Create Railway project

1. Go to **https://railway.app** → Sign up with GitHub (free)
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `ytai-cloud` repo
4. Railway auto-detects Node.js and starts building

#### 8c. Set environment variables

In Railway dashboard → your service → **"Variables"** tab → click **"Raw Editor"** and paste:

```env
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb+srv://ytai:YOUR_PASS@cluster0.xxxxx.mongodb.net/ytai?retryWrites=true&w=majority
REDIS_URL=rediss://default:YOUR_PASS@YOUR_HOST.upstash.io:6379
GROQ_API_KEY=gsk_YOUR_KEY
HUGGINGFACE_API_KEY=hf_YOUR_KEY
PEXELS_API_KEY=YOUR_KEY
PIXABAY_API_KEY=YOUR_KEY
CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
CLOUDFLARE_R2_ACCESS_KEY=YOUR_KEY
CLOUDFLARE_R2_SECRET_KEY=YOUR_KEY
CLOUDFLARE_R2_BUCKET=ytai-videos
CLOUDFLARE_R2_PUBLIC_URL=https://pub-xxx.r2.dev
YOUTUBE_CLIENT_ID=YOUR_CLIENT_ID
YOUTUBE_CLIENT_SECRET=YOUR_SECRET
YOUTUBE_REDIRECT_URI=https://YOUR-APP.railway.app/api/auth/callback
STORAGE_PROVIDER=r2
MAX_VIDEOS_PER_DAY=2
SCRIPT_WORD_COUNT=1200
GROQ_MODEL_SCRIPT=llama3-8b-8192
GROQ_MODEL_SEO=mixtral-8x7b-32768
```

#### 8d. Add a second Railway service for workers

1. In your Railway project → **"New Service"** → **"GitHub Repo"** → same repo
2. In this service's settings → **"Start Command"**: `node dist/workers/index.js`
3. Add the same environment variables to this service too
4. Give it a name: `workers`

#### 8e. Get your Railway URL

In the API service → **Settings → Networking → Generate Domain**  
Your URL will be: `https://ytai-cloud-production-xxxx.railway.app`

---

### STEP 9 — YouTube OAuth (one-time auth)

```bash
# 1. Open in browser:
https://YOUR-APP.railway.app/api/auth/youtube

# 2. Copy the authUrl from the response and open it
# 3. Sign in with your YouTube channel Google account
# 4. After approval → redirected to /api/auth/callback
# 5. Tokens are saved to Railway's filesystem (tokens/default.json)
```

⚠️ **Important:** Railway's filesystem resets on redeploy. To persist tokens:
- After auth, copy the token from Railway logs
- Add `YOUTUBE_REFRESH_TOKEN=your_token` to environment variables
- The app will use this env var as fallback

---

### STEP 10 — Test the deployment

```bash
# Health check
curl https://YOUR-APP.railway.app/health

# Trigger one test video
curl -X POST https://YOUR-APP.railway.app/api/pipeline/video \
  -H "Content-Type: application/json" \
  -d '{"topicTitle": "The Future of Artificial Intelligence in 2025"}'

# Watch progress
curl https://YOUR-APP.railway.app/api/dashboard

# Get video status
curl https://YOUR-APP.railway.app/api/videos/YOUR_VIDEO_ID/status
```

---

## 🔄 How the daily automation works

Railway runs your server 24/7. Inside it, `node-cron` fires on schedule:

```
06:00 UTC → Topic Discovery
            └─ Fetches Google Trends, Reddit, HN, RSS
            └─ Creates video jobs in MongoDB
            └─ Pushes to BullMQ (Upstash)

            Workers pick up jobs:
            Script → Voice → Visuals+Subtitles (parallel)
            → Video Assembly → Thumbnail+SEO (parallel) → Upload

10:00 UTC → Videos publish on YouTube (scheduled)
```

Total time per video: ~15–25 minutes (mostly HuggingFace TTS)

---

## 💰 Cost breakdown

| Service | Cost |
|---|---|
| Railway | **$0** (500 hrs free = ~20 days/month, enough for 2 services) |
| MongoDB Atlas | **$0** |
| Upstash | **$0** |
| Groq API | **$0** |
| HuggingFace | **$0** |
| Cloudflare R2 | **$0** |
| Pexels / Pixabay | **$0** |
| YouTube API | **$0** |
| **TOTAL** | **$0/month** |

---

## ⚠️ Staying within free limits

**Railway 500 hrs/month:**
- 2 services × 24h × 20 days = 960 hrs → over limit
- Fix: Set Railway to **sleep when inactive** or use **Render free tier** for workers instead

**Alternative: Use Render for workers (also free):**
1. Go to https://render.com → Sign up
2. New → Background Worker → connect GitHub repo
3. Start command: `npm ci && npm run build && node dist/workers/index.js`
4. Add same env vars
5. Free tier: 750 hrs/month per service

**Groq 30 req/min:**
- Script + SEO = 2 calls per video
- At 2 videos/day = 4 calls/day → well within limits

**HuggingFace 30,000 calls/month:**
- TTS splits script into ~10 chunks per video
- 2 videos/day × 30 days × 10 chunks = 600 calls/month → well within limits

---

## 🔧 Useful commands

```bash
# Check Railway logs
railway logs

# Redeploy after code change
git push origin main  # Railway auto-deploys

# Test Groq connection
curl https://YOUR-APP.railway.app/health

# Manually trigger topics
curl -X POST https://YOUR-APP.railway.app/api/pipeline/trigger \
  -H "Content-Type: application/json" -d '{"channelId":"default"}'

# List all videos
curl https://YOUR-APP.railway.app/api/videos

# Retry failed video
curl -X POST https://YOUR-APP.railway.app/api/videos/VIDEO_ID/retry
```

---

## 🐛 Troubleshooting

**"Groq rate limit"**
→ Already handled with auto-retry after 60s. Or switch model to `gemma-7b-it`

**"HuggingFace 503 model loading"**
→ Already handled with 20s wait + retry. First call per day is slower.

**"R2 upload failed"**
→ Check CLOUDFLARE_R2_ACCESS_KEY and CLOUDFLARE_ACCOUNT_ID are correct
→ Verify bucket is named exactly `ytai-videos`

**"YouTube tokens expired"**
→ Re-run OAuth: visit `/api/auth/youtube`
→ Add refresh token to env vars for persistence

**"Railway out of hours"**
→ Move workers to Render.com (750 hrs free separately)
→ Or reduce to 1 video/day

**"MongoDB connection timeout"**
→ Check Atlas → Network Access → IP `0.0.0.0/0` is whitelisted
→ Verify password has no special characters that need URL encoding

---

## 🌐 Alternative free platforms

If Railway runs out of hours, these are alternatives:

| Platform | Free Tier | Use for |
|---|---|---|
| **Render** | 750 hrs/month | Workers |
| **Fly.io** | 3 shared VMs free | API server |
| **Koyeb** | 2 services free | API + workers |
| **Cyclic** | Unlimited serverless | API only |
| **Vercel** | Serverless functions | API (no long jobs) |

**Recommended split:**
- Railway → API server (always-on, uses ~360 hrs/month)
- Render → Workers (750 hrs free separately)
- Total cost: **$0**
