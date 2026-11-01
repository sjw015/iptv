//✅ 部署步骤：
1. 在 Cloudflare Workers 中创建新 Worker。
2. 绑定 KV 命名空间（变量名为 SUB_KV）。
3. 将以上代码粘贴并部署。
4. 如有需要，在 Worker 设置中添加环境变量 FIXED_SLUG 强制固定链接 ID。
//

export default {
  async fetch(request, env) {
    // 处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 处理推送 (POST /api/push)
    if (request.method === 'POST' && path === '/api/push') {
      try {
        const { content, format, slug } = await request.json();
        if (!content) throw new Error('Empty content');

        let id = slug?.trim() || Math.random().toString(36).substring(2, 10);
        if (env.FIXED_SLUG && env.FIXED_SLUG.trim() !== '') {
          id = env.FIXED_SLUG.trim();
        }

        await env.SUB_KV.put(id, content, { metadata: { format } });

        return new Response(JSON.stringify({ success: true, id: id }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }

    // 2. 处理拉取 (GET /:slug)
    const match = path.match(/^\/([a-zA-Z0-9_-]+)$/);
    if (request.method === 'GET' && match) {
      const slug = match[1];
      const { value, metadata } = await env.SUB_KV.getWithMetadata(slug);

      if (!value) {
        return new Response('Not Found or Expired', {
          status: 404,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }

      let ctype = 'text/plain';
      if (metadata?.format === 'm3u') ctype = 'application/vnd.apple.mpegurl';
      else if (metadata?.format === 'json') ctype = 'application/json';

      return new Response(value, {
        headers: {
          'Content-Type': `${ctype}; charset=utf-8`,
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 3. 根目录健康检查
    if (path === '/') {
      return new Response('TVBox Sub Host is Running 🚀', {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    return new Response('Invalid Request', {
      status: 400,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
};
