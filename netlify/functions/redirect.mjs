// Netlify Function: redirect links, track clicks, record last IP, countries, cities, and filter bots
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

  // Bot filter: skip known crawlers and Notion previews
  const userAgent = (event.headers['user-agent'] || '');
  const referer = event.headers['referer'] || '';
  let isBot = /bot|crawl|spider|slurp|facebookexternalhit|twitterbot|preview|notion/i.test(userAgent) || referer.includes('notion.so');

  // Capture client IP
  const forwarded = event.headers['x-forwarded-for'] || '';
  const clientIp = forwarded.split(',')[0].trim();
  // Mark AWS IPs as bots
  if (/^(54|52|34)\./.test(clientIp)) isBot = true;

  try {
    // Debounce valid GET hits
    if (method === 'GET' && !isBot) {
      const now = Date.now();
      if (lastClickMap[shortId] && now - lastClickMap[shortId] < 30000) {
        const url = await getUrlWithoutUpdate(notionHeaders, notionDb, shortId);
        return { statusCode: 302, headers: { Location: url }, body: '' };
      }
      lastClickMap[shortId] = now;
    }

    // Query the row
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${notionDb}/query`, {
      method: 'POST', headers: notionHeaders,
      body: JSON.stringify({ filter: { property: 'Short ID', rich_text: { equals: shortId } } })
    });
    const result = await queryRes.json();
    if (!Array.isArray(result.results) || result.results.length === 0) {
      return { statusCode: 404, body: 'Short ID not found.' };
    }
    const page = result.results[0];
    const pageId = page.id;
    let url = page.properties.URL.url;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    // Geo-lookup via free IP API
    let country = 'unknown', city = 'unknown';
    try {
      const geo = await fetch(`https://ipapi.co/${clientIp}/json/`).then(r=>r.json());
      country = geo.country_name || country;
      city = geo.city || city;
    } catch {}

    // Prepare Notion update
    const props = {};
    // Click count and timestamp
    if (method === 'GET' && !isBot) {
      const clicks = page.properties.Clicks.number || 0;
      props.Clicks = { number: clicks + 1 };
      props['Last Clicked'] = { date: { start: new Date().toISOString() } };
    }
    // Last IP
    props['Last IP'] = { rich_text: [{ text: { content: clientIp }}] };

    // Multi-select for countries
    const existingCountries = (page.properties.Countries.multi_select || []).map(i=>i.name);
    if (!existingCountries.includes(country) && country !== 'unknown') {
      props.Countries = { multi_select: existingCountries.map(name=>({ name })).concat({ name: country }) };
    }
    // Multi-select for cities
    const existingCities = (page.properties.Cities.multi_select || []).map(i=>i.name);
    if (!existingCities.includes(city) && city !== 'unknown') {
      props.Cities = { multi_select: existingCities.map(name=>({ name })).concat({ name: city }) };
    }

    // Send update if any
    if (Object.keys(props).length) {
      await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH', headers: notionHeaders,
        body: JSON.stringify({ properties: props })
      });
    }

    // Redirect
    return { statusCode: 302, headers: { Location: url }, body: '' };
  } catch (e) {
    return { statusCode: 500, body: `Server error: ${e.message}` };
  }
};

async function getUrlWithoutUpdate(headers, db, shortId) {
  const r = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
    method: 'POST', headers, body: JSON.stringify({ filter: { property: 'Short ID', rich_text: { equals: shortId } } })
  });
  const d = await r.json();
  let u = d.results[0].properties.URL.url;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}
