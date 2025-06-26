// Netlify Function: redirect links and track clicks in Notion
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

  const filterPayload = {
    filter: {
      property: 'Short ID',
      rich_text: { equals: shortId }
    }
  };

  try {
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

    // Only increment on GET and avoid double-counts within 30s
    if (method === 'GET') {
      const clicksProp = page.properties.Clicks;
      const clicks = clicksProp && typeof clicksProp.number === 'number' ? clicksProp.number : 0;
      const lastClickedProp = page.properties['Last Clicked'];
      const lastClickedTime = lastClickedProp && lastClickedProp.date && lastClickedProp.date.start
        ? new Date(lastClickedProp.date.start).getTime()
        : 0;
      const now = Date.now();

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

    return { statusCode: 302, headers: { Location: url }, body: '' };
  } catch (error) {
    return { statusCode: 500, body: `Server error: ${error.message}` };
  }
};
