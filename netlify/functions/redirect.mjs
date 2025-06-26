// Netlify Function: redirect links, track clicks, record last IP, and filter out bot/previews
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

  // Bot and preview filter: skip known crawlers and Notion preview fetches
  const userAgent = (event.headers['user-agent'] || '') + '';
  const referer = event.headers['referer'] || '';
  const isBot = /bot|crawl|spider|slurp|facebookexternalhit|twitterbot|twitterbot|preview|notion/i.test(userAgent) || referer.includes('notion.so');
    // Also skip known AWS datacenter IPs used by Notion previews
    const awsIp = clientIp.startsWith('54.') || clientIp.startsWith('52.') || clientIp.startsWith('34.');
    if (awsIp) isBot = true;

  // Capture client IP (first in X-Forwarded-For)
  const forwarded = event.headers['x-forwarded-for'] || '';
  const clientIp = forwarded.split(',')[0].trim();

  try {
    // Debounce valid GET hits
    if (method === 'GET' && !isBot) {
      const now = Date.now();
      const last = lastClickMap[shortId] || 0;
      if (now - last < 30000) {
        const url = await getUrlWithoutUpdate(notionHeaders, notionDb, shortId);
        return { statusCode: 302, headers: { Location: url }, body: '' };
      }
      lastClickMap[shortId] = now;
    }

    // Query Notion for the page row
    const queryRes = await fetch(
      `https://api.notion.com/v1/databases/${notionDb}/query`,
      { method: 'POST', headers: notionHeaders, body: JSON.stringify({ filter: { property: 'Short ID', rich_text: { equals: shortId } } }) }
    );
    const data = await queryRes.json();
    if (!Array.isArray(data.results) || data.results.length === 0) {
      return { statusCode: 404, body: 'Short ID not found.' };
    }

    const page = data.results[0];
    const pageId = page.id;
    let url = page.properties.URL.url;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    // Prepare Notion update properties
    const props = {};
    if (method === 'GET' && !isBot) {
      const clicksProp = page.properties.Clicks;
      const clicks = clicksProp && typeof clicksProp.number === 'number' ? clicksProp.number : 0;
      props.Clicks = { number: clicks + 1 };
      props['Last Clicked'] = { date: { start: new Date().toISOString() } };
    }
    props['Last IP'] = { rich_text: [{ text: { content: clientIp || 'unknown' } }] };

    // Send update to Notion
    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH', headers: notionHeaders, body: JSON.stringify({ properties: props })
    });

    // Redirect
    return { statusCode: 302, headers: { Location: url }, body: '' };
  } catch (error) {
    return { statusCode: 500, body: `Server error: ${error.message}` };
  }
};

// Helper to fetch URL without updating
async function getUrlWithoutUpdate(notionHeaders, notionDb, shortId) {
  const r = await fetch(
    `https://api.notion.com/v1/databases/${notionDb}/query`,
    { method: 'POST', headers: notionHeaders, body: JSON.stringify({ filter: { property: 'Short ID', rich_text: { equals: shortId } } }) }
  );
  const d = await r.json();
  const p = d.results[0];
  let u = p.properties.URL.url;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}
