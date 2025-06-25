import fetch from 'node-fetch';

export async function handler(event) {
  const shortId = event.path.replace(/^\//, '');
  const notionToken = process.env.NOTION_KEY;
  const notionDb = process.env.NOTION_DB;

  const notionHeaders = {
    'Authorization': `Bearer ${notionToken}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  const filterPayload = {
    filter: {
      property: 'Short ID',
      rich_text: {
        equals: shortId
      }
    }
  };

  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${notionDb}/query`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify(filterPayload)
    });

    const data = await res.json();
    const match = data.results && data.results[0];

    if (!match) {
      return { statusCode: 404, body: 'Short ID not found.' };
    }

    const pageId = match.id;
    let url = match.properties.URL.url;
    const clicks = match.properties.Clicks && match.properties.Clicks.number
      ? match.properties.Clicks.number
      : 0;

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: notionHeaders,
      body: JSON.stringify({
        properties: {
          Clicks: { number: clicks + 1 },
          'Last Clicked': {
            date: { start: new Date().toISOString() }
          }
        }
      })
    });

    return {
      statusCode: 302,
      headers: {
        Location: url,
        'Cache-Control': 'no-cache'
      },
      body: ''
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: `Server error: ${err.message}`
    };
  }
}
