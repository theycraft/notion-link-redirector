// Netlify Function: redirect links and track clicks in Notion
exports.handler = async function(event) {
  // Only count clicks on GET requests
  const method = event.httpMethod;
  
  // Extract short ID from path (e.g. /abc123)
  const shortId = event.path.replace(/^\//, '');

  // Notion credentials from environment
  const notionToken = process.env.NOTION_KEY;
  const notionDb = process.env.NOTION_DB;

  // Common request headers for Notion API
  const notionHeaders = {
    Authorization: `Bearer ${notionToken}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  // Build query payload to find the page by Short ID
  const filterPayload = {
    filter: {
      property: 'Short ID',
      rich_text: { equals: shortId }
    }
  };

  try {
    // Query database
    const queryRes = await fetch(
      `https://api.notion.com/v1/databases/${notionDb}/query`,
      {
        method: 'POST',
        headers: notionHeaders,
        body: JSON.stringify(filterPayload)
      }
    );
    const data = await queryRes.json();

    // Validate result
    if (!Array.isArray(data.results) || data.results.length === 0) {
      return { statusCode: 404, body: 'Short ID not found.' };
    }

    const page = data.results[0];
    const pageId = page.id;

    // Extract and normalize URL
    let url = page.properties.URL.url;
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    // If a GET request, update click count
    if (method === 'GET') {
      const clicksProp = page.properties.Clicks;
      const clicks =
        clicksProp && typeof clicksProp.number === 'number'
          ? clicksProp.number
          : 0;

      // Update click count and timestamp in Notion
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
    }

    // Return an HTTP redirect for all methods
    return {
      statusCode: 302,
      headers: { Location: url },
      body: ''
    };
  } catch (error) {
    // Handle any errors
    return {
      statusCode: 500,
      body: `Server error: ${error.message}`
    };
  }
};
