// ─────────────────────────────────────────────────────────────
// INSYNERA Lead Generation Backend
// Node.js + Express — Companies House API Proxy
// ─────────────────────────────────────────────────────────────

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CH_API_KEY = process.env.CH_API_KEY;
const AGENCY_NAME = process.env.AGENCY_NAME || 'INSYNERA';
const YOUR_NAME = process.env.YOUR_NAME || 'Your Name';
const AGENCY_URL = process.env.AGENCY_URL || 'https://insynera.com';

// ── VALIDATE CONFIG ──────────────────────────────────────────
if (!CH_API_KEY || CH_API_KEY === 'YOUR_API_KEY_HERE') {
  console.error('\n❌  No API key found.');
  console.error('    Copy .env.example to .env and add your Companies House API key.');
  console.error('    Get one free at: https://developer-specs.company-information.service.gov.uk/\n');
  process.exit(1);
}

// ── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rate limit: 60 requests per minute (well within CH's 600/5min)
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: 'Too many requests' } });
app.use('/api/', limiter);

// ── SIC CODE DATA ────────────────────────────────────────────
const SIC_LABELS = {
  '43110': 'Demolition',
  '43120': 'Site Preparation',
  '43210': 'Electrical Installation',
  '43220': 'Plumbing & Heating',
  '43290': 'Other Installation',
  '43310': 'Plastering',
  '43320': 'Joinery & Carpentry',
  '43330': 'Floor & Wall Covering',
  '43340': 'Painting & Glazing',
  '43390': 'Other Finishing',
  '43910': 'Roofing',
  '43990': 'Other Construction',
  '56101': 'Restaurants & Cafes',
  '56102': 'Unlicensed Restaurants',
  '56210': 'Event Catering',
  '56301': 'Licensed Clubs',
  '56302': 'Public Houses & Bars',
  '96020': 'Hairdressing & Beauty',
  '86900': 'Other Health Services',
  '86210': 'GP Practices',
  '86230': 'Dental Practices',
  '55100': 'Hotels',
  '55201': 'Holiday Centres',
  '55209': 'B&Bs & Guest Houses',
  '93110': 'Sports Facilities',
  '93130': 'Fitness Facilities',
  '96090': 'Personal Services',
  '47190': 'Retail',
  '47710': 'Clothing Retail',
  '47910': 'Online Retail',
};

const HIGH_VALUE_SIC_PREFIXES = ['4321', '4322', '4391', '4399', '9602', '5610', '8690', '8621', '8623', '5520', '9311', '9313'];

function getSICLabel(code) {
  if (!code) return 'General Business';
  const str = String(code);
  if (SIC_LABELS[str]) return SIC_LABELS[str];
  for (let len = 4; len >= 2; len--) {
    const key = str.slice(0, len);
    for (const [k, v] of Object.entries(SIC_LABELS)) {
      if (k.startsWith(key)) return v;
    }
  }
  return `SIC ${code}`;
}

function isHighValue(sic) {
  const str = String(sic || '');
  return HIGH_VALUE_SIC_PREFIXES.some(p => str.startsWith(p));
}

// ── LEAD SCORING ─────────────────────────────────────────────
function scoreLead(company) {
  let score = 50;
  const signals = [];

  // Base: new company = no website
  signals.push({ key: 'NW', label: 'No Website', on: true, title: 'Newly incorporated — almost certainly no website' });
  score += 20;

  // Days since incorporation
  const days = daysSince(company.date_of_creation);
  if (days <= 7) {
    score += 25;
    signals.push({ key: '7D', label: '< 7 Days Old', on: true, title: `Incorporated ${days} day(s) ago — hottest window` });
  } else if (days <= 14) {
    score += 15;
    signals.push({ key: '2W', label: '< 2 Weeks', on: true, title: `Incorporated ${days} days ago` });
  } else if (days <= 30) {
    score += 5;
    signals.push({ key: '1M', label: '< 1 Month', on: true, title: `Incorporated ${days} days ago` });
  } else {
    signals.push({ key: '1M', label: '> 1 Month', on: false, title: `Incorporated ${days} days ago` });
  }

  // High value industry
  const sics = company.sic_codes || [];
  const hvMatch = sics.some(s => isHighValue(s));
  if (hvMatch) {
    score += 10;
    signals.push({ key: 'HV', label: 'High-Value Niche', on: true, title: 'Industry with strong website ROI' });
  } else {
    signals.push({ key: 'HV', label: 'High-Value Niche', on: false, title: 'Standard industry' });
  }

  // Has director name
  if (company.director_name) {
    score += 5;
    signals.push({ key: 'DIR', label: 'Director Found', on: true, title: `Director: ${company.director_name}` });
  } else {
    signals.push({ key: 'DIR', label: 'Director Found', on: false, title: 'Director name not retrieved' });
  }

  // Ltd company = clean legal basis
  signals.push({ key: 'LTD', label: 'Ltd Company', on: true, title: 'Limited company — legitimate interest basis applies cleanly' });
  score += 5;

  // Has registered address (contact potential)
  if (company.registered_office_address?.postal_code) {
    signals.push({ key: 'ADDR', label: 'Address Found', on: true, title: `Postcode: ${company.registered_office_address.postal_code}` });
  }

  score = Math.min(score, 100);
  const status = score >= 80 ? 'hot' : score >= 55 ? 'warm' : 'cold';
  return { score, signals, status };
}

function daysSince(dateStr) {
  if (!dateStr) return 999;
  const d = new Date(dateStr);
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// ── EMAIL TEMPLATES ──────────────────────────────────────────
function generateEmailTemplate(company) {
  const days = daysSince(company.date_of_creation);
  const industry = getSICLabel((company.sic_codes || [])[0]);
  const city = company.registered_office_address?.locality || company.registered_office_address?.region || 'your area';
  const firstName = company.director_name ? company.director_name.split(' ').pop() : null;
  const greeting = firstName ? `Hi ${firstName}` : 'Hi there';
  const recency = days <= 7 ? 'this week' : days <= 14 ? 'recently' : 'last month';
  const sic = String((company.sic_codes || [''])[0]);

  const templates = {
    construction: {
      subject: `Quick question — ${company.title}`,
      body: `${greeting},

Congratulations on incorporating ${company.title} ${recency}.

I run ${AGENCY_NAME} — we build websites for trades businesses across the UK. Most new ${industry.toLowerCase()} companies we speak to are ready to start quoting jobs but don't have anything online yet.

I put together a quick demo of what your site could look like — happy to share it if useful. Takes 30 seconds to look at and there's no obligation.

Would a quick call this week work?

— ${YOUR_NAME}
${AGENCY_NAME}
${AGENCY_URL}`
    },

    food: {
      subject: `Website for ${company.title}?`,
      body: `${greeting},

Saw that ${company.title} just incorporated ${recency} — exciting.

I build websites for restaurants and food businesses in ${city}. Most new places lose bookings in those first weeks simply because people can't find them online.

I've built a quick demo of what yours could look like — want me to send it over?

— ${YOUR_NAME}
${AGENCY_NAME}
${AGENCY_URL}`
    },

    beauty: {
      subject: `${company.title} — free website demo`,
      body: `${greeting},

Just noticed ${company.title} incorporated ${recency} — great time to get set up online.

I build websites for hair and beauty businesses in ${city}, specifically ones with online booking built in so clients can book without calling.

I've put together a quick demo for ${company.title}. Want me to send the link?

— ${YOUR_NAME}
${AGENCY_NAME}
${AGENCY_URL}`
    },

    health: {
      subject: `Getting ${company.title} online`,
      body: `${greeting},

Congratulations on setting up ${company.title} ${recency}.

I help health and wellness businesses in ${city} get professional websites live quickly — the kind that build trust with new patients and clients from day one.

Happy to share a quick demo built for your type of practice. No obligation.

— ${YOUR_NAME}
${AGENCY_NAME}
${AGENCY_URL}`
    },

    default: {
      subject: `${company.title} — just incorporated`,
      body: `${greeting},

Congratulations on incorporating ${company.title}${days <= 14 ? ` ${recency}` : ''}.

I run ${AGENCY_NAME}, a web agency. We help newly registered UK businesses get a professional website live fast — the kind that actually brings in enquiries from day one.

I put together a demo of what yours could look like. Want me to send it over?

— ${YOUR_NAME}
${AGENCY_NAME}
${AGENCY_URL}`
    }
  };

  if (sic.startsWith('43') || sic.startsWith('42')) return templates.construction;
  if (sic.startsWith('56') || sic.startsWith('55')) return templates.food;
  if (sic === '96020') return templates.beauty;
  if (sic.startsWith('86')) return templates.health;
  return templates.default;
}

// ── COMPANIES HOUSE API HELPER ───────────────────────────────
const CH_BASE = 'https://api.company-information.service.gov.uk';

async function chFetch(path) {
  const credentials = Buffer.from(`${CH_API_KEY}:`).toString('base64');
  const res = await fetch(`${CH_BASE}${path}`, {
    headers: { 'Authorization': `Basic ${credentials}` }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CH API ${res.status}: ${err}`);
  }
  return res.json();
}

async function getDirectorName(companyNumber) {
  try {
    const data = await chFetch(`/company/${companyNumber}/officers?items_per_page=5`);
    const director = (data.items || []).find(o =>
      o.officer_role === 'director' && !o.resigned_on
    );
    if (!director) return null;
    const name = director.name || '';
    // CH returns names as "SURNAME, Firstname" — flip it
    const parts = name.split(',');
    if (parts.length === 2) {
      return `${parts[1].trim()} ${parts[0].trim()}`;
    }
    return name;
  } catch {
    return null;
  }
}

// ── ROUTES ───────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', agency: AGENCY_NAME, timestamp: new Date().toISOString() });
});

// ── KEYWORD GROUPS ───────────────────────────────────────────
const KEYWORD_GROUPS = {
  trades: ['plumbing', 'electrical', 'roofing', 'heating', 'construction', 'building', 'drainage', 'joinery', 'plastering', 'groundworks'],
  food: ['restaurant', 'cafe', 'catering', 'takeaway', 'kitchen', 'pizza', 'burger', 'bakery', 'coffee', 'bistro'],
  beauty: ['hair', 'beauty', 'salon', 'aesthetics', 'nails', 'barber', 'lashes', 'brows', 'skincare', 'grooming'],
  health: ['physio', 'therapy', 'dental', 'clinic', 'care', 'wellbeing', 'massage', 'nutrition', 'fitness', 'yoga'],
  general: ['services', 'solutions', 'group', 'cleaning', 'logistics', 'media', 'tech', 'design', 'consulting', 'management'],
};

// ── HELPER: fetch one keyword ─────────────────────────────────
async function fetchKeyword(keyword, cutoff, sic, location) {
  try {
    const params = new URLSearchParams({ q: keyword, items_per_page: 50 });
    const data = await chFetch(`/search/companies?${params}`);
    return (data.items || []).filter(c => {
      if (c.company_status !== 'active') return false;
      if (!c.date_of_creation) return false;
      if (new Date(c.date_of_creation) < cutoff) return false;
      if (sic && sic !== '') {
        const sics = c.sic_codes || [];
        if (!sics.some(s => String(s).startsWith(sic.slice(0, 2)))) return false;
      }
      if (location) {
        const addr = JSON.stringify(c.registered_office_address || '').toLowerCase();
        if (!addr.includes(location.toLowerCase())) return false;
      }
      return true;
    });
  } catch (e) {
    console.error(`Keyword "${keyword}" failed:`, e.message);
    return [];
  }
}

// ── SEARCH (single keyword) ───────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { q = '', sic = '', location = '', days = '60', size = '50' } = req.query;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(days));
    const query = q || location || 'services';

    const items = await fetchKeyword(query, cutoff, sic, location);
    console.log(`Single search "${query}": ${items.length} results`);

    const companies = mapAndScore(items, parseInt(size));
    res.json({ total: companies.length, api_total: items.length, companies });

  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── BULK SEARCH (all keywords at once) ───────────────────────
app.get('/api/bulk-search', async (req, res) => {
  const { sic = '', location = '', days = '60', size = '200', group = 'all' } = req.query;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(days));

    // Pick keyword list
    let keywords = [];
    if (group === 'all') {
      keywords = Object.values(KEYWORD_GROUPS).flat();
    } else if (KEYWORD_GROUPS[group]) {
      keywords = KEYWORD_GROUPS[group];
    } else {
      keywords = Object.values(KEYWORD_GROUPS).flat();
    }

    console.log(`Bulk search: ${keywords.length} keywords, cutoff: ${cutoff.toISOString().slice(0,10)}`);

    // Run all keywords in parallel (batches of 5 to avoid rate limits)
    const allItems = [];
    const seen = new Set();
    const batchSize = 5;

    for (let i = 0; i < keywords.length; i += batchSize) {
      const batch = keywords.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(kw => fetchKeyword(kw, cutoff, sic, location)));
      for (const items of results) {
        for (const item of items) {
          if (!seen.has(item.company_number)) {
            seen.add(item.company_number);
            allItems.push(item);
          }
        }
      }
      // Small delay between batches to be respectful of rate limits
      if (i + batchSize < keywords.length) await new Promise(r => setTimeout(r, 300));
    }

    console.log(`Bulk: ${allItems.length} unique companies found`);

    const companies = mapAndScore(allItems, parseInt(size));
    res.json({ total: companies.length, api_total: allItems.length, companies, keywords_searched: keywords.length });

  } catch (err) {
    console.error('Bulk search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MAP + SCORE HELPER ────────────────────────────────────────
function mapAndScore(items, limit = 200) {
  return items.map(c => {
    const base = {
      number: c.company_number,
      name: c.title || c.company_name || '',
      incorporated: c.date_of_creation,
      postcode: c.registered_office_address?.postal_code || '',
      city: c.registered_office_address?.locality || c.registered_office_address?.region || '',
      address: c.registered_office_address,
      sic: (c.sic_codes || [])[0] || '',
      sic_codes: c.sic_codes || [],
      industry: getSICLabel((c.sic_codes || [])[0]),
      type: c.company_type,
      status_text: c.company_status,
      director_name: null
    };
    const { score, signals, status } = scoreLead(base);
    return { ...base, score, signals, status };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}

// Get single company details + director
app.get('/api/company/:number', async (req, res) => {
  const { number } = req.params;
  try {
    const [company, directorName] = await Promise.all([
      chFetch(`/company/${number}`),
      getDirectorName(number)
    ]);

    const enriched = {
      number: company.company_number,
      name: company.company_name,
      incorporated: company.date_of_creation,
      postcode: company.registered_office_address?.postal_code || '',
      city: company.registered_office_address?.locality || '',
      address: company.registered_office_address,
      sic_codes: company.sic_codes || [],
      industry: getSICLabel((company.sic_codes || [])[0]),
      director_name: directorName,
      type: company.type,
      status_text: company.company_status,
    };

    const { score, signals, status } = scoreLead(enriched);
    enriched.score = score;
    enriched.signals = signals;
    enriched.status = status;

    // Generate email
    enriched.email_template = generateEmailTemplate(enriched);

    res.json(enriched);
  } catch (err) {
    console.error('Company fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get newly incorporated companies (advanced filter)
app.get('/api/new-companies', async (req, res) => {
  const { sic_prefix, location, days = '14', size = '50' } = req.query;

  try {
    // Search for recently incorporated companies
    const params = new URLSearchParams({
      q: location || 'limited',
      items_per_page: 50,
      restrictions: 'active-companies'
    });

    const data = await chFetch(`/search/companies?${params}`);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(days));

    let companies = (data.items || [])
      .filter(c => {
        if (c.company_status !== 'active') return false;
        if (!c.date_of_creation) return false;
        if (new Date(c.date_of_creation) < cutoff) return false;
        if (sic_prefix) {
          const sics = c.sic_codes || [];
          if (!sics.some(s => s.startsWith(sic_prefix))) return false;
        }
        return true;
      })
      .map(c => {
        const base = {
          number: c.company_number,
          name: c.title,
          incorporated: c.date_of_creation,
          postcode: c.registered_office_address?.postal_code || '',
          city: c.registered_office_address?.locality || '',
          address: c.registered_office_address,
          sic: (c.sic_codes || [])[0] || '',
          sic_codes: c.sic_codes || [],
          industry: getSICLabel((c.sic_codes || [])[0]),
          director_name: null
        };
        const { score, signals, status } = scoreLead(base);
        return { ...base, score, signals, status };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, parseInt(size));

    res.json({ total: companies.length, companies });
  } catch (err) {
    console.error('New companies error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Generate email for a company
app.post('/api/email', async (req, res) => {
  const { company } = req.body;
  if (!company) return res.status(400).json({ error: 'Company data required' });

  try {
    const template = generateEmailTemplate(company);
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export leads as CSV
app.post('/api/export', (req, res) => {
  const { leads } = req.body;
  if (!leads || !leads.length) return res.status(400).json({ error: 'No leads provided' });

  const headers = [
    'Company Name', 'Company Number', 'Industry', 'SIC Code',
    'City', 'Postcode', 'Incorporated', 'Days Since Inc.',
    'Director', 'Score', 'Status', 'Companies House URL'
  ];

  const rows = leads.map(l => [
    `"${(l.name || '').replace(/"/g, '""')}"`,
    l.number,
    getSICLabel(l.sic),
    l.sic,
    l.city,
    l.postcode,
    l.incorporated,
    daysSince(l.incorporated),
    l.director_name || '',
    l.score,
    l.status,
    `https://find-and-update.company-information.service.gov.uk/company/${l.number}`
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="insynera-leads-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── START ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  INSYNERA Lead System running`);
  console.log(`    Local:   http://localhost:${PORT}`);
  console.log(`    API:     http://localhost:${PORT}/api/health`);
  console.log(`    Agency:  ${AGENCY_NAME}`);
  console.log(`\n    Press Ctrl+C to stop\n`);
});
