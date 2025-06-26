// Netlify Function: redirect links and track clicks in Notion, with bot filtering and in-memory debounce
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

  try {
    // If it's a GET from a legit user, check in-memory debounce
    if (method === 'GET' && !isBot) {
      const now = Date.now();
      const last = lastClickMap[shortId] || 0;
      // If last click was within 30s, skip counting
      if (now - last < 30000) {
        // Just perform redirect
        const initialUrl = await getUrlAndRedirect(event, notionHeaders, notionDb, shortId);
        return { statusCode: 302, headers: { Location: initialUrl }, body: '' };
      }
      lastClickMap[shortId] = now;
    }

    // For non-skipped cases, query and update
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

    // Only update click count on GET and not bots
    if (method === 'GET' && !isBot) {
      const clicksProp = page.properties.Clicks;
      const clicks = clicksProp && typeof clicksProp.number === 'number' ? clicksProp.number : 0;
      await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: notionHeaders,
        body: JSON.stringify({ properties: { Clicks: { number: clicks + 1 }, 'Last Clicked': { date: { start: new Date().toISOString() } } } })
      });
    }

    // Redirect
    return { statusCode: 302, headers: { Location: url }, body: '' };
  } catch (error) {
    return { statusCode: 500, body: `Server error: ${error.message}` };
  }
};

// Helper to quickly fetch URL without updating Notion
async function getUrlAndRedirect(event, notionHeaders, notionDb, shortId) {
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
