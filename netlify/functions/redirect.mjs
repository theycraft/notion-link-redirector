// Netlify Function: redirect links and track clicks in Notion, with bot filtering
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

  const filterPayload = {
    filter: {
      property: 'Short ID',
      rich_text: { equals: shortId }
    }
  };

  try {
    // Query the Notion database for the matching short ID
    const queryRes = await fetch(
      `https://api.notion.com/v1/databases/${notionDb}/query`,
      { method: 'POST', headers: notionHeaders, body: JSON.stringify(filterPayload) }
    );
    const data = await queryRes.json();

    if (!Array.isArray(data.results) || data.results.length === 0) {
      return { statusCode: 404, body: 'Short ID not found.' };
    }

    const page = data.results[0];
    const pageId = page.id;
    let url = page.properties.URL.url;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    // Increment click count only on real GET requests, not bots, and debounce
    if (method === 'GET' && !isBot) {
      const clicksProp = page.properties.Clicks;
      const clicks = clicksProp && typeof clicksProp.number === 'number' ? clicksProp.number : 0;
      const lastClickedProp = page.properties['Last Clicked'];
      const lastClickedTime = lastClickedProp && lastClickedProp.date && lastClickedProp.date.start
        ? new Date(lastClickedProp.date.start).getTime()
        : 0;
      const now = Date.now();

      // Avoid counting multiple hits within 30 seconds
      if (now - lastClickedTime > 30000) {
        await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
          method: 'PATCH',
          headers: notionHeaders,
          body: JSON.stringify({
            properties: {
              Clicks: { number: clicks + 1 },
              'Last Clicked': { date: { start: new Date().toISOString() } }
            }
          })
        });
      }
    }

    // Perform the redirect
    return { statusCode: 302, headers: { Location: url }, body: '' };
  } catch (error) {
    return { statusCode: 500, body: `Server error: ${error.message}` };
  }
};
