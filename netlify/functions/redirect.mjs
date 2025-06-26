// Netlify Function: redirect links, track clicks, and record last IP in Notion
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

  // Basic bot filter: skip known crawler UAs
  const userAgent = event.headers['user-agent'] || '';
  const isBot = /bot|crawl|spider|slurp|facebookexternalhit|twitterbot/i.test(userAgent);

  // Capture client IP (first in X-Forwarded-For)
  const forwarded = event.headers['x-forwarded-for'] || '';
  const clientIp = forwarded.split(',')[0].trim();

  try {
    // Debounce rapid repeats in memory
    if (method === 'GET' && !isBot) {
      const now = Date.now();
      const last = lastClickMap[shortId] || 0;
      if (now - last < 30000) {
        const initialUrl = await getUrlWithoutUpdate(event, notionHeaders, notionDb, shortId);
        return { statusCode: 302, headers: { Location: initialUrl }, body: '' };
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

    // Prepare properties update
    const propertiesToUpdate = {};
    if (method === 'GET' && !isBot) {
      const clicksProp = page.properties.Clicks;
      const clicks = clicksProp && typeof clicksProp.number === 'number' ? clicksProp.number : 0;
      propertiesToUpdate.Clicks = { number: clicks + 1 };
      propertiesToUpdate['Last Clicked'] = { date: { start: new Date().toISOString() } };
    }
    // Always record last IP
    propertiesToUpdate['Last IP'] = { rich_text: [{ text: { content: clientIp || 'unknown' } }] };

    // Send update to Notion if any properties
    if (Object.keys(propertiesToUpdate).length > 0) {
      await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: notionHeaders,
        body: JSON.stringify({ properties: propertiesToUpdate })
      });
    }

    // Redirect
    return { statusCode: 302, headers: { Location: url }, body: '' };
  } catch (error) {
    return { statusCode: 500, body: `Server error: ${error.message}` };
  }
};

// Fetch URL without updating Notion
async function getUrlWithoutUpdate(event, notionHeaders, notionDb, shortId) {
  const queryRes = await fetch(
    `https://api.notion.com/v1/databases/${notionDb}/query`,
    { method: 'POST', headers: notionHeaders, body: JSON.stringify({ filter: { property: 'Short ID', rich_text: { equals: shortId } } }) }
  );
  const data = await queryRes.json();
  const page = data.results[0];
  let url = page.properties.URL.url;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}
