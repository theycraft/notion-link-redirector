// Netlify Function: redirect links, track clicks & location, record last IP, filter bots & previews
const lastClickMap = {};

exports.handler = async function(event) {
  const method = event.httpMethod;
  const shortId = event.path.replace(/^\//, '');

  const notionToken = process.env.NOTION_KEY;
  const notionDb = process.env.NOTION_DB;
  const notionHeaders = {
    Authorization: `Bearer ${notionToken}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  // Detect bots/crawlers, Notion preview, Facebook, Twitter bots
  const ua = (event.headers['user-agent'] || '').toLowerCase();
  const ref = (event.headers['referer'] || '').toLowerCase();
  const isBotUA = /bot|crawl|spider|slurp|facebookexternalhit|twitterbot|preview|notion/i.test(ua) || ref.includes('notion.so');

  // Capture client IP
  const forwarded = event.headers['x-forwarded-for'] || '';
  const clientIp = forwarded.split(',')[0].trim();

  // If UA indicates bot or preview, skip DB updates
  if (isBotUA) {
    const url = await getUrlWithoutUpdate(notionHeaders, notionDb, shortId);
    return { statusCode: 302, headers: { Location: url }, body: '' };
  }

  // Debounce human GET requests (30s)
  if (method === 'GET') {
    const now = Date.now();
    if (lastClickMap[shortId] && now - lastClickMap[shortId] < 30000) {
      const url = await getUrlWithoutUpdate(notionHeaders, notionDb, shortId);
      return { statusCode: 302, headers: { Location: url }, body: '' };
    }
    lastClickMap[shortId] = now;
  }

  try {
    // Query Notion for the page
    const queryRes = await fetch(
      `https://api.notion.com/v1/databases/${notionDb}/query`,
      { method: 'POST', headers: notionHeaders,
        body: JSON.stringify({ filter: { property: 'Short ID', rich_text: { equals: shortId } } }) }
    );
    const data = await queryRes.json();
    if (data.results?.length === 0) {
      return { statusCode: 404, body: 'Short ID not found.' };
    }
    const page = data.results[0];
    const pageId = page.id;

    // Normalize destination URL
    let url = page.properties.URL.url;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    // Geo-lookup (country & city)
    let country = 'unknown', city = 'unknown';
    try {
      const geo = await fetch(`https://ipapi.co/${clientIp}/json/`).then(r => r.json());
      country = geo.country_name || country;
      city    = geo.city || city;
    } catch {}

    // Build properties to update
    const props = {};

    // Increment clicks and timestamp
    if (method === 'GET') {
      const currentClicks = page.properties.Clicks?.number || 0;
      props.Clicks = { number: currentClicks + 1 };
      props['Last Clicked'] = { date: { start: new Date().toISOString() } };

      // Append country in multi-select
      const existingCountries = page.properties.Countries?.multi_select?.map(i => i.name) || [];
      if (country !== 'unknown' && !existingCountries.includes(country)) {
        props.Countries = { multi_select: [...existingCountries.map(n => ({ name: n })), { name: country }] };
      }
      // Append city in multi-select
      const existingCities = page.properties.Cities?.multi_select?.map(i => i.name) || [];
      if (city !== 'unknown' && !existingCities.includes(city)) {
        props.Cities = { multi_select: [...existingCities.map(n => ({ name: n })), { name: city }] };
      }
    }

    // Always record last IP
    props['Last IP'] = { rich_text: [{ text: { content: clientIp || 'unknown' } }] };

    // Send update if any props exist
    if (Object.keys(props).length) {
      await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH', headers: notionHeaders,
        body: JSON.stringify({ properties: props })
      });
    }

    // Redirect
    return { statusCode: 302, headers: { Location: url }, body: '' };

  } catch (err) {
    return { statusCode: 500, body: `Server error: ${err.message}` };
  }
};

// Helper to fetch URL without updating DB
async function getUrlWithoutUpdate(headers, db, shortId) {
  const r = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
    method: 'POST', headers,
    body: JSON.stringify({ filter: { property: 'Short ID', rich_text: { equals: shortId } } })
  });
  const d = await r.json();
  let u = d.results[0]?.properties.URL.url || '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}
