# INSYNERA Lead Generation System
### Companies House API Backend — Setup Guide

---

## What This Does

Searches live UK Companies House data for newly incorporated businesses that almost certainly have no website yet. Scores every lead, fetches director names, and generates personalised outreach emails automatically.

---

## Prerequisites

- **Node.js** installed on your machine
  - Check: open Terminal and type `node -v`
  - If not installed: https://nodejs.org (download the LTS version)
- A **Companies House API key** (free)
  - Get one at: https://developer-specs.company-information.service.gov.uk/

---

## Setup (5 minutes)

### Step 1 — Install dependencies

Open Terminal, navigate to this folder, and run:

```bash
npm install
```

### Step 2 — Add your API key

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` in any text editor and replace `YOUR_API_KEY_HERE` with your actual key:

```
CH_API_KEY=abc123yourkeyhere
YOUR_NAME=Your Name
AGENCY_NAME=INSYNERA
AGENCY_URL=https://insynera.com
```

### Step 3 — Start the server

```bash
npm start
```

You should see:

```
✅  INSYNERA Lead System running
    Local:   http://localhost:3000
    API:     http://localhost:3000/api/health
```

### Step 4 — Open the app

Go to: **http://localhost:3000**

The header will show **LIVE** in green when connected successfully.

---

## Using the System

### Searching for Leads

1. Enter a keyword (e.g. `plumbing`, `cafe`, `hair`) or leave blank for all
2. Select an industry from the SIC dropdown
3. Enter a city or postcode (e.g. `Cardiff`, `NP10`)
4. Choose how recently they incorporated (7–60 days)
5. Click **Search**

### Reading the Results

Every lead is automatically scored 0–100 and tagged:

| Status | Score | Meaning |
|--------|-------|---------|
| 🔴 HOT | 80+ | Brand new, high-value industry — contact today |
| 🟡 WARM | 55–79 | Good prospect — follow up this week |
| ⚪ COLD | <55 | Lower priority — skip or revisit later |

### Getting Director Names

Click any lead to open the detail panel. The system automatically fetches the director's name from Companies House. This takes 1–2 seconds.

### Generating Outreach Emails

In the detail panel, click **Generate Personalised Email**. The system creates a tailored email based on:
- Industry (trades, food, beauty, health all get different templates)
- How recently they incorporated
- Director's first name (if found)
- City/location

Click **Copy Email** to copy it to your clipboard, ready to paste into Gmail.

### Exporting to CSV

Click **↓ CSV** to export the current view (all, hot, warm, or saved) as a spreadsheet. Import this into Airtable, HubSpot, or Instantly for follow-up tracking.

---

## API Endpoints

The backend exposes these endpoints directly if you want to integrate further:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server status check |
| `/api/search?q=&sic=&location=&days=&size=` | GET | Search companies |
| `/api/company/:number` | GET | Get company + director + email |
| `/api/email` | POST | Generate email template |
| `/api/export` | POST | Export leads as CSV |

---

## Deploying Online (Optional)

To run this 24/7 without your laptop being on:

### Option A — Railway (free tier)

1. Create account at https://railway.app
2. Connect your GitHub repo (push this folder to GitHub first)
3. Add your environment variables in Railway's dashboard
4. Railway auto-deploys and gives you a public URL

### Option B — Render (free tier)

1. Create account at https://render.com
2. New Web Service → connect GitHub repo
3. Build command: `npm install`
4. Start command: `node server/index.js`
5. Add environment variables

Both free tiers are more than sufficient for personal use.

---

## Daily Workflow

1. Open http://localhost:3000 (or your deployed URL)
2. Search for your target niche + location
3. Filter by 🔴 HOT
4. Click top leads, copy email
5. Paste into Gmail and send
6. Save leads you've contacted with ⭐

Spend 30–45 minutes per day. Target 10–20 outreach emails daily.

---

## Troubleshooting

**Server won't start / "No API key found"**
→ Make sure you created `.env` (not just `.env.example`) and added your real key

**Header shows "SERVER OFFLINE"**
→ The Node server isn't running. Open Terminal and run `npm start`

**Search returns 0 results**
→ Try broadening your search — remove the location filter or increase the days range. The Companies House search API works best with short keywords.

**Director name shows "Not found"**
→ Click the "Find Director ↗" button to open Companies House directly. Some directors register with privacy protection.

---

## Notes

- Companies House free API: 600 requests per 5 minutes — more than enough
- All data is sourced from public Companies House records
- Ltd company outreach is on solid legal footing under UK GDPR legitimate interest
- Never commit your `.env` file to GitHub — it's in `.gitignore` already
