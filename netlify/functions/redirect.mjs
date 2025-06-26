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

  // Detect bots/crawlers, Notion preview, social media bots
  const ua = (event.headers['user-agent'] || '').toLowerCase();
  const ref = (event.headers['referer'] || '').toLowerCase();
  const isBotUA = /bot|crawl|spider|slurp|facebookexternalhit|twitterbot|preview|notion/i.test(ua) || ref.includes('notion.so');

  // Capture client IP and flag data-center ranges
  const forwarded = event.headers['x-forwarded-for'] || '';
  const clientIp = forwarded.split(',')[0].trim();
  const isDataCenterIp = /^(54|52|34|13)\./.test(clientIp);

  // Skip updates for bots or data-center IPs
  if (isBotUA || isDataCenterIp) {
    const redirectUrl = await fetchUrl(shortId, notionHeaders, notionDb);
    return { statusCode: 302, headers: { Location: redirectUrl }, body: '' };
  }

  // Debounce repeated GETs
  if (method === 'GET') {
    const now = Date.now();
    if (lastClickMap[shortId] && now - lastClickMap[shortId] < 30000) {
      const redirectUrl = await fetchUrl(shortId, notionHeaders, notionDb);
      return { statusCode: 302, headers: { Location: redirectUrl }, body: '' };
    }
    lastClickMap[shortId] = now;
  }

  try {
    // Query Notion for the record
    const queryRes = await fetch(
      `https://api.notion.com/v1/databases/${notionDb}/query`,
      {
        method: 'POST',
        headers: notionHeaders,
        body: JSON.stringify({ filter: { property: 'Short ID', rich_text: { equals: shortId } } })
      }
    );
    const data = await queryRes.json();
    if (!data.results || data.results.length === 0) {
      return { statusCode: 404, body: 'Short ID not found.' };
    }
    const page = data.results[0];
    const pageId = page.id;

    // Determine redirect URL
    let url = page.properties.URL.url || '';
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;

    // Geo-lookup (country & city)
    let country = 'unknown';
    let city = 'unknown';
    try {
      const geoRes = await fetch(`https://ipapi.co/${clientIp}/json/`);
      const geoData = await geoRes.json();
      country = geoData.country_name || country;
      city = geoData.city || city;
    } catch (e) {
      // ignore lookup errors
    }

    // Build properties update
    const props = {};

    // If GET, increment clicks and append location
    if (method === 'GET') {
      const clicks = page.properties.Clicks?.number || 0;
      props.Clicks = { number: clicks + 1 };
      props['Last Clicked'] = { date: { start: new Date().toISOString() } };

      // Multi-select Countries
      const existingCountries = (page.properties.Countries?.multi_select || []).map(i => i.name);
      const updatedCountries = existingCountries.includes(country)
        ? existingCountries
        : existingCountries.concat(country);
      props.Countries = { multi_select: updatedCountries.map(name => ({ name })) };

      // Multi-select Cities
      const existingCities = (page.properties.Cities?.multi_select || []).map(i => i.name);
      const updatedCities = existingCities.includes(city)
        ? existingCities
        : existingCities.concat(city);
      props.Cities = { multi_select: updatedCities.map(name => ({ name })) };
    }

    // Always record Last IP
    props['Last IP'] = { rich_text: [{ text: { content: clientIp || 'unknown' } }] };

    // Submit update
    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: notionHeaders,
      body: JSON.stringify({ properties: props })
    });

    // Redirect
    return { statusCode: 302, headers: { Location: url }, body: '' };
  } catch (err) {
    return { statusCode: 500, body: `Error: ${err.message}` };
  }
};

// Helper: fetch redirect URL without DB update
async function fetchUrl(shortId, headers, db) {
  const res = await fetch(
    `https://api.notion.com/v1/databases/${db}/query`,
    { method: 'POST', headers, body: JSON.stringify({ filter: { property: 'Short ID', rich_text: { equals: shortId } } }) }
  );
  const js = await res.json();
  let u = js.results[0]?.properties.URL.url || '';
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}
