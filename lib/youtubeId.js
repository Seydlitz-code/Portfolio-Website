/**
 * YouTube URL 또는 11자 비디오 ID에서 embed용 ID 추출.
 */
function extractYoutubeVideoId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === 'm.youtube.com' || host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      let m = u.pathname.match(/\/embed\/([\w-]{11})/);
      if (m) return m[1];
      m = u.pathname.match(/\/shorts\/([\w-]{11})/);
      if (m) return m[1];
      m = u.pathname.match(/\/live\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch (e) {
    return null;
  }
  return null;
}

function buildYoutubeEmbedBlock(videoId, originalUrl) {
  const safeId = String(videoId || '').replace(/[^0-9A-Za-z_-]/g, '');
  if (!safeId || safeId.length !== 11) return '';
  const esc = (t) =>
    String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const href =
    originalUrl && String(originalUrl).trim() ? String(originalUrl).trim() : `https://www.youtube.com/watch?v=${safeId}`;
  const label = esc(href);
  return (
    `<div class="post-embed post-embed--youtube">` +
    `<div class="post-embed-yt-frame">` +
    `<iframe loading="lazy" title="YouTube video" src="https://www.youtube-nocookie.com/embed/${safeId}" ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
    `allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>` +
    `</div>` +
    `<p class="post-embed-link"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a></p>` +
    `</div>`
  );
}

module.exports = { extractYoutubeVideoId, buildYoutubeEmbedBlock };
