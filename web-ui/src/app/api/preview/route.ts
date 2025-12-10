import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        // Use Facebook's crawler User-Agent to ensure Instagram/Facebook serve static HTML with Open Graph tags
        // instead of a client-side rendered page (which often hides metadata from standard scrapers).
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch' }, { status: response.status });
    }

    const html = await response.text();

    // Helper to find meta content regardless of attribute order
    const getMeta = (propName: string) => {
      // Try property first
      const p1 = new RegExp(`<meta\\s+[^>]*property=["']${propName}["']\\s+[^>]*content=["']([^"']+)["']`, 'i').exec(html);
      if (p1) return decodeHtmlEntities(p1[1]);

      // Try content first
      const p2 = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["']\\s+[^>]*property=["']${propName}["']`, 'i').exec(html);
      if (p2) return decodeHtmlEntities(p2[1]);

      // Try name attribute (e.g. twitter:image often uses name)
      const p3 = new RegExp(`<meta\\s+[^>]*name=["']${propName}["']\\s+[^>]*content=["']([^"']+)["']`, 'i').exec(html);
      if (p3) return decodeHtmlEntities(p3[1]);

      const p4 = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["']\\s+[^>]*name=["']${propName}["']`, 'i').exec(html);
      if (p4) return decodeHtmlEntities(p4[1]);

      return null;
    };

    const image = getMeta('og:image') || getMeta('twitter:image');
    const title = getMeta('og:title') || getMeta('twitter:title');
    const description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description');

    console.log(`Preview fetch for ${targetUrl}: title=${title ? 'found' : 'missing'}, image=${image ? 'found' : 'missing'}`);

    return NextResponse.json({
      url: targetUrl,
      image,
      title,
      description,
    });
  } catch (error) {
    console.error('Preview fetch error:', error);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}

function decodeHtmlEntities(str: string) {
  return str
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'");
}
