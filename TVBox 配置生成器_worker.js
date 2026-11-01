// Cloudflare Pages Worker - HTML渲染器托管工具
// KV绑定：HTML_KV (变量名)
// 环境变量：UPLOAD_PASSWORD (可选，默认 ymzz123)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 主页面：显示指定外部URL内容
    if (path === '/') {
      return handleMainPage(request, env);
    }

    // 上传页面及相关API
    if (path === '/ymzz' || path.startsWith('/ymzz/')) {
      return handleUploadPage(request, env);
    }

    // 匹配 /ID/{随机8位} 显示KV中的HTML
    const match = path.match(/^\/ID\/([A-Za-z0-9]{8})$/);
    if (match) {
      return handleHtmlDisplay(request, env, match[1]);
    }

    return new Response('Not Found', { status: 404 });
  }
};

// ==================== 主页面转发 ====================
async function handleMainPage(request, env) {
  const targetUrl = 'https://zztv.wdtv.ccwu.cc/P/apwfeFQw';
  try {
    const resp = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PagesProxy/1.0)' }
    });
    if (!resp.ok) throw new Error(`上游返回 ${resp.status}`);
    const contentType = resp.headers.get('Content-Type') || 'text/html';
    const body = await resp.text();
    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300',
        'X-Proxy-By': 'Cloudflare Pages Worker'
      }
    });
  } catch (e) {
    return new Response(`主页面加载失败：${e.message}`, { status: 502, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  }
}

// ==================== 上传页面处理 ====================
async function handleUploadPage(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const password = env.UPLOAD_PASSWORD || 'ymzz123';

  // 登录处理
  if (path === '/ymzz/login' && request.method === 'POST') {
    const formData = await request.formData();
    const pwd = formData.get('password') || '';
    if (pwd === password) {
      const headers = new Headers();
      headers.set('Set-Cookie', `ymzz_auth=1; Path=/; HttpOnly; Max-Age=3600; SameSite=Lax`);
      headers.set('Location', '/ymzz');
      return new Response(null, { status: 302, headers });
    } else {
      return new Response(renderLoginPage(true), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }
  }

  // 检查登录状态
  const cookie = request.headers.get('Cookie') || '';
  const isAuthed = cookie.includes('ymzz_auth=1');

  if (!isAuthed) {
    return new Response(renderLoginPage(false), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  }

  // 已登录，处理上传及更新API
  if (path === '/ymzz/upload-url' && request.method === 'POST') {
    return handleUploadFromUrl(request, env);
  }
  if (path === '/ymzz/upload-code' && request.method === 'POST') {
    return handleUploadFromCode(request, env);
  }
  if (path === '/ymzz/upload-file' && request.method === 'POST') {
    return handleUploadFromFile(request, env);
  }
  // 新增：支持指定 ID 的原地精准覆盖更新 API
  if (path === '/ymzz/update-code' && request.method === 'POST') {
    return handleUpdateCode(request, env);
  }

  // 显示上传页面
  return new Response(renderUploadPage(), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}

// ==================== 上传处理函数 ====================
async function handleUploadFromUrl(request, env) {
  const formData = await request.formData();
  const rawUrl = formData.get('url') || '';
  if (!rawUrl) return new Response('URL 不能为空', { status: 400 });
  try {
    const resp = await fetch(rawUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new Error(`上游返回 ${resp.status}`);
    const html = await resp.text();
    const result = await saveHtml(env, html);
    return new Response(JSON.stringify({ success: true, url: result.url }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleUploadFromCode(request, env) {
  const formData = await request.formData();
  const code = formData.get('code') || '';
  if (!code.trim()) return new Response('代码不能为空', { status: 400 });
  const result = await saveHtml(env, code);
  return new Response(JSON.stringify({ success: true, url: result.url }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleUploadFromFile(request, env) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') return new Response('请选择文件', { status: 400 });
  const filename = file.name || 'upload.html';
  const ext = filename.split('.').pop().toLowerCase();
  if (!['html', 'htm', 'txt'].includes(ext)) {
    return new Response('仅支持 html, htm, txt 文件', { status: 400 });
  }
  const content = await file.text();
  const result = await saveHtml(env, content);
  return new Response(JSON.stringify({ success: true, url: result.url, filename }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// 新增：处理已有 ID 的覆盖更新逻辑
async function handleUpdateCode(request, env) {
  const formData = await request.formData();
  const code = formData.get('code') || '';
  const slug = formData.get('slug') || '';
  if (!code.trim() || !slug.trim()) {
    return new Response(JSON.stringify({ success: false, error: '内容或 ID 不能为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const key = `html:ID/${slug}`;
  await env.HTML_KV.put(key, code);
  return new Response(JSON.stringify({ success: true, url: `/ID/${slug}` }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function saveHtml(env, htmlContent) {
  const random = Math.random().toString(36).substring(2, 10);
  const key = `html:ID/${random}`;
  await env.HTML_KV.put(key, htmlContent);
  return { url: `/ID/${random}` };
}

// ==================== HTML显示 ====================
async function handleHtmlDisplay(request, env, random) {
  const key = `html:ID/${random}`;
  const html = await env.HTML_KV.get(key);
  if (html === null) {
    return new Response('页面不存在', { status: 404, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  }
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      'Cache-Control': 'no-cache' // 禁用缓存，确保每次加载最新内容
    }
  });
}

// ==================== 登录页面模板（使用外部Logo） ====================
function renderLoginPage(showError) {
  const logoUrl = 'https://dh.351148.xyz/mao/logo.gif';
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>登录 - HTML渲染器</title>
  <link rel="icon" href="${logoUrl}">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    :root {
      --bg-primary:#f2f2f7; --bg-secondary:#ffffff; --bg-card:rgba(255,255,255,0.72);
      --text-primary:#1c1c1e; --text-secondary:#3a3a3c; --text-tertiary:#8e8e93;
      --border-light:rgba(60,60,67,0.08); --border-focus:#007aff;
      --shadow-md:0 20px 50px rgba(0,0,0,0.06); --accent-gradient:linear-gradient(135deg,#007aff 0%,#5856d6 100%);
      --tab-bg:rgba(118,118,128,0.12); --tab-active:#ffffff; --input-bg:rgba(118,118,128,0.06);
    }
    [data-theme="dark"] {
      --bg-primary:#0b0b0e; --bg-secondary:#1c1c1e; --bg-card:rgba(28,28,30,0.75);
      --text-primary:#f5f5f7; --text-secondary:#aeaeb2; --text-tertiary:#636366;
      --border-light:rgba(255,255,255,0.08); --border-focus:#0a84ff;
      --shadow-md:0 20px 50px rgba(0,0,0,0.7); --tab-bg:rgba(118,118,128,0.18); --tab-active:#2c2c2e; --input-bg:rgba(118,118,128,0.10);
    }
    body { font-family:-apple-system,'Helvetica Neue',sans-serif; background:var(--bg-primary); color:var(--text-primary); min-height:100vh; display:flex; justify-content:center; align-items:center; padding:24px 16px; transition:background .35s ease,color .35s ease; }
    .container { max-width:420px; width:100%; background:var(--bg-card); backdrop-filter:saturate(180%) blur(24px); -webkit-backdrop-filter:saturate(180%) blur(24px); border-radius:44px; padding:40px 36px; box-shadow:var(--shadow-md), inset 0 0 0 .5px rgba(255,255,255,0.1); border:.5px solid var(--border-light); transition:all .35s cubic-bezier(.25,.1,.25,1); text-align:center; }
    .logo { width:80px; height:80px; border-radius:50%; margin-bottom:20px; object-fit:cover; border:1px solid var(--border-light); }
    h2 { font-size:22px; font-weight:700; margin-bottom:8px; background:var(--accent-gradient); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    .sub { font-size:13px; color:var(--text-tertiary); margin-bottom:24px; }
    .error { color:#ff3b30; font-size:14px; margin-bottom:12px; font-weight:500; }
    input[type="password"] { width:100%; padding:14px 16px; border:1.5px solid var(--border-light); border-radius:18px; font-size:16px; background:var(--input-bg); color:var(--text-primary); outline:none; transition:border .25s; margin-bottom:16px; }
    input[type="password"]:focus { border-color:var(--border-focus); background:var(--bg-secondary); box-shadow:0 0 0 4px rgba(0,122,255,0.08); }
    button { width:100%; padding:16px; border:none; border-radius:40px; font-size:17px; font-weight:600; cursor:pointer; background:var(--accent-gradient); color:white; letter-spacing:.2px; box-shadow:0 4px 16px rgba(0,122,255,0.18); transition:all .3s; font-family:inherit; }
    button:hover { transform:scale(1.01); box-shadow:0 8px 28px rgba(0,122,255,0.25); }
    button:active { transform:scale(0.97); }
  </style>
</head>
<body>
  <div class="container">
    <img class="logo" src="${logoUrl}" alt="logo">
    <h2>HTML渲染器</h2>
    <div class="sub">请输入密码以继续</div>
    ${showError ? '<div class="error">❌ 密码错误，请重试</div>' : ''}
    <form action="/ymzz/login" method="POST">
      <input type="password" name="password" placeholder="密码" required autofocus>
      <button type="submit">登 录</button>
    </form>
  </div>
</body>
</html>`;
}

// ==================== 上传页面模板（使用外部Logo） ====================
function renderUploadPage() {
  const logoUrl = 'https://dh.351148.xyz/mao/logo.gif';
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>HTML渲染器 - 上传</title>
  <link rel="icon" href="${logoUrl}">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    :root {
      --bg-primary:#f2f2f7; --bg-secondary:#ffffff; --bg-card:rgba(255,255,255,0.72); --bg-card-hover:rgba(255,255,255,0.88);
      --text-primary:#1c1c1e; --text-secondary:#3a3a3c; --text-tertiary:#8e8e93;
      --border-light:rgba(60,60,67,0.08); --border-focus:#007aff;
      --shadow-md:0 20px 50px rgba(0,0,0,0.06); --accent-gradient:linear-gradient(135deg,#007aff 0%,#5856d6 100%);
      --tab-bg:rgba(118,118,128,0.12); --tab-active:#ffffff; --input-bg:rgba(118,118,128,0.06);
      --result-bg:rgba(0,122,255,0.06); --result-border:rgba(0,122,255,0.15);
      --error-bg:rgba(255,59,48,0.06); --error-border:rgba(255,59,48,0.15);
    }
    [data-theme="dark"] {
      --bg-primary:#0b0b0e; --bg-secondary:#1c1c1e; --bg-card:rgba(28,28,30,0.75); --bg-card-hover:rgba(44,44,46,0.9);
      --text-primary:#f5f5f7; --text-secondary:#aeaeb2; --text-tertiary:#636366;
      --border-light:rgba(255,255,255,0.08); --border-focus:#0a84ff;
      --shadow-md:0 20px 50px rgba(0,0,0,0.7); --tab-bg:rgba(118,118,128,0.18); --tab-active:#2c2c2e; --input-bg:rgba(118,118,128,0.10);
      --result-bg:rgba(10,132,255,0.10); --result-border:rgba(10,132,255,0.20);
      --error-bg:rgba(255,69,58,0.08); --error-border:rgba(255,69,58,0.18);
    }
    body { font-family:-apple-system,'Helvetica Neue',sans-serif; background:var(--bg-primary); color:var(--text-primary); min-height:100vh; display:flex; justify-content:center; align-items:center; padding:24px 16px; transition:background .35s ease,color .35s ease; }
    .container { max-width:720px; width:100%; background:var(--bg-card); backdrop-filter:saturate(180%) blur(24px); -webkit-backdrop-filter:saturate(180%) blur(24px); border-radius:44px; padding:40px 36px; box-shadow:var(--shadow-md), inset 0 0 0 .5px rgba(255,255,255,0.1); border:.5px solid var(--border-light); transition:all .35s cubic-bezier(.25,.1,.25,1); }
    .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:32px; }
    .brand { display:flex; align-items:center; gap:14px; }
    .avatar { width:48px; height:48px; border-radius:50%; object-fit:cover; background:var(--border-light); box-shadow:0 4px 12px rgba(0,0,0,0.04); border:1px solid var(--border-light); flex-shrink:0; }
    .brand-text { display:flex; flex-direction:column; }
    .brand-name { font-size:22px; font-weight:700; letter-spacing:-0.3px; background:var(--accent-gradient); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; line-height:1.2; }
    .brand-sub { font-size:12px; font-weight:500; color:var(--text-tertiary); letter-spacing:0.2px; margin-top:2px; }
    .theme-toggle { width:44px; height:44px; border-radius:50%; background:var(--tab-bg); border:.5px solid var(--border-light); color:var(--text-secondary); font-size:20px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .3s ease; backdrop-filter:blur(4px); flex-shrink:0; -webkit-tap-highlight-color:transparent; }
    .theme-toggle:hover { background:var(--bg-card-hover); transform:scale(1.02); }
    .theme-toggle:active { transform:scale(0.94); }
    .tab-container { display:flex; gap:4px; margin-bottom:32px; background:var(--tab-bg); border-radius:40px; padding:4px; transition:background .3s; backdrop-filter:blur(4px); }
    .tab { flex:1; padding:10px 8px; border:none; border-radius:32px; font-size:14px; font-weight:600; cursor:pointer; transition:all .3s cubic-bezier(.25,.1,.25,1); background:transparent; color:var(--text-tertiary); letter-spacing:-0.2px; font-family:inherit; -webkit-tap-highlight-color:transparent; }
    .tab.active { background:var(--tab-active); color:var(--text-primary); box-shadow:0 8px 30px rgba(0,0,0,0.04); border:.5px solid var(--border-light); }
    .tab:hover:not(.active) { color:var(--text-secondary); }
    .panel { display:none; animation:fadeIn .4s ease; }
    .panel.active { display:block; }
    @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
    .input-group { margin-bottom:24px; }
    .input-group label { display:block; font-size:13px; font-weight:600; color:var(--text-secondary); margin-bottom:8px; letter-spacing:-0.1px; }
    textarea, .drop-zone { width:100%; padding:16px 18px; border:1.5px solid var(--border-light); border-radius:18px; font-size:15px; font-family:'SF Mono','Menlo',monospace; transition:all .25s ease; resize:vertical; background:var(--input-bg); color:var(--text-primary); backdrop-filter:blur(4px); line-height:1.5; }
    textarea { min-height:96px; }
    textarea:focus { outline:none; border-color:var(--border-focus); background:var(--bg-secondary); box-shadow:0 0 0 4px rgba(0,122,255,0.08); }
    .drop-zone { min-height:170px; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; border-style:dashed; gap:8px; background:var(--input-bg); }
    .drop-zone:hover { border-color:var(--border-focus); background:var(--bg-card-hover); }
    .drop-zone.dragover { border-color:var(--border-focus); background:var(--result-bg); border-style:solid; }
    .drop-icon { font-size:36px; opacity:0.7; }
    .drop-text { font-size:15px; font-weight:500; color:var(--text-secondary); }
    .drop-hint { font-size:13px; color:var(--text-tertiary); }
    .file-name { margin-top:10px; font-size:14px; font-weight:500; color:#007aff; padding-left:4px; }
    .btn { width:100%; padding:16px 20px; border:none; border-radius:40px; font-size:17px; font-weight:600; cursor:pointer; transition:all .3s cubic-bezier(.25,.1,.25,1); background:var(--accent-gradient); color:white; letter-spacing:.2px; box-shadow:0 4px 16px rgba(0,122,255,0.18); font-family:inherit; -webkit-tap-highlight-color:transparent; }
    .btn:hover:not(:disabled) { transform:scale(1.01); box-shadow:0 8px 28px rgba(0,122,255,0.25); }
    .btn:active:not(:disabled) { transform:scale(0.97); }
    .btn:disabled { opacity:0.5; cursor:default; box-shadow:none; }
    .result-box { margin-top:28px; padding:0; border-radius:20px; display:none; overflow:hidden; border:.5px solid var(--border-light); background:var(--bg-secondary); transition:all .3s; }
    .result-box.show { display:block; }
    .result-box.success { border-color:var(--result-border); background:var(--result-bg); }
    .result-box.error { border-color:var(--error-border); background:var(--error-bg); }
    .result-inner { padding:18px 20px; }
    .result-label { font-size:12px; font-weight:600; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.3px; margin-bottom:10px; }
    .result-link { display:flex; align-items:center; flex-wrap:wrap; gap:12px; padding:12px 16px; background:var(--bg-card); border-radius:16px; backdrop-filter:blur(4px); border:.5px solid var(--border-light); }
    .result-link a { color:#007aff; text-decoration:none; font-weight:500; font-size:15px; word-break:break-all; flex:1; min-width:0; }
    .result-link a:hover { text-decoration:underline; }
    .copy-btn { padding:6px 18px; border:.5px solid var(--border-light); border-radius:30px; background:transparent; color:var(--text-secondary); cursor:pointer; font-size:13px; font-weight:500; transition:all .2s; white-space:nowrap; font-family:inherit; backdrop-filter:blur(4px); -webkit-tap-highlight-color:transparent; }
    .copy-btn:hover { background:var(--bg-card-hover); color:var(--text-primary); }
    .copy-btn:active { transform:scale(0.94); }
    .error-text { color:#ff3b30; padding:4px 0; font-weight:500; }
    @media (max-width:600px) { body { padding:16px 12px; } .container { padding:28px 20px; border-radius:32px; } .brand-name { font-size:19px; } .avatar { width:40px; height:40px; } .tab { font-size:12px; padding:8px 4px; } .btn { font-size:16px; padding:14px; } .result-link { flex-direction:column; align-items:stretch; gap:10px; } .copy-btn { align-self:flex-end; } }
    @media (max-width:440px) { .header { flex-wrap:wrap; gap:12px; } .theme-toggle { width:40px; height:40px; font-size:18px; } }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="brand">
        <img class="avatar" src="${logoUrl}" alt="logo" loading="lazy">
        <div class="brand-text">
          <span class="brand-name">HTML渲染器</span>
          <span class="brand-sub">永久链接 · 无需部署</span>
        </div>
      </div>
      <button class="theme-toggle" id="themeToggle" aria-label="切换深色/浅色模式"><span id="themeIcon">☀️</span></button>
    </header>

    <div class="tab-container" role="tablist">
      <button class="tab active" data-tab="url" role="tab">🌐 从 URL</button>
      <button class="tab" data-tab="code" role="tab">📝 粘贴代码</button>
      <button class="tab" data-tab="upload" role="tab">📤 上传文件</button>
    </div>

    <div class="panel active" id="panel-url" role="tabpanel">
      <div class="input-group">
        <label for="urlInput">GitHub / Bitbucket 原始链接</label>
        <textarea id="urlInput" placeholder="https://raw.githubusercontent.com/用户/仓库/分支/文件.html"></textarea>
      </div>
      <button class="btn" id="urlBtn">🚀 生成永久链接</button>
      <div class="result-box" id="urlResult"><div class="result-inner"></div></div>
    </div>

    <div class="panel" id="panel-code" role="tabpanel">
      <div class="input-group">
        <label for="codeInput">直接粘贴 HTML 代码</label>
        <textarea id="codeInput" placeholder="&lt;!DOCTYPE html&gt;&#10;&lt;html&gt;&#10;&lt;head&gt;&lt;title&gt;我的页面&lt;/title&gt;&lt;/head&gt;&#10;&lt;body&gt;&lt;h1&gt;Hello World&lt;/h1&gt;&lt;/body&gt;&#10;&lt;/html&gt;"></textarea>
      </div>
      <button class="btn" id="codeBtn">🚀 生成永久链接</button>
      <div class="result-box" id="codeResult"><div class="result-inner"></div></div>
    </div>

    <div class="panel" id="panel-upload" role="tabpanel">
      <div class="input-group">
        <label>上传 HTML 文件</label>
        <div class="drop-zone" id="dropZone">
          <div class="drop-icon">📄</div>
          <div class="drop-text">拖拽或点击选择文件</div>
          <div class="drop-hint">支持 .html / .htm / .txt</div>
          <input type="file" id="fileInput" accept=".html,.htm,.txt" style="display:none">
        </div>
        <div class="file-name" id="fileName"></div>
      </div>
      <button class="btn" id="uploadBtn" disabled>🚀 生成永久链接</button>
      <div class="result-box" id="uploadResult"><div class="result-inner"></div></div>
    </div>
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', function() {
      // 主题切换
      function getStorage(key) { try { return localStorage.getItem(key); } catch(e) { return null; } }
      function setStorage(key, val) { try { localStorage.setItem(key, val); } catch(e) {} }
      var htmlElement = document.documentElement;
      var themeToggle = document.getElementById('themeToggle');
      var themeIcon = document.getElementById('themeIcon');
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var currentTheme = getStorage('theme') || (prefersDark ? 'dark' : 'light');
      function applyTheme(theme) {
        htmlElement.setAttribute('data-theme', theme);
        currentTheme = theme;
        setStorage('theme', theme);
        themeIcon.textContent = theme === 'light' ? '🌙' : '☀️';
      }
      applyTheme(currentTheme);
      themeToggle.addEventListener('click', function() {
        applyTheme(currentTheme === 'light' ? 'dark' : 'light');
      });

      // 标签切换
      var tabs = document.querySelectorAll('.tab');
      var panels = { url: document.getElementById('panel-url'), code: document.getElementById('panel-code'), upload: document.getElementById('panel-upload') };
      tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
          tabs.forEach(function(t) { t.classList.remove('active'); });
          this.classList.add('active');
          for (var key in panels) panels[key].classList.remove('active');
          var target = this.getAttribute('data-tab');
          panels[target].classList.add('active');
          document.querySelectorAll('.result-box').forEach(function(r) { r.classList.remove('show'); });
        });
      });

      // 显示结果
      function showResult(element, content, isError) {
        isError = isError || false;
        var inner = element.querySelector('.result-inner') || element;
        element.className = 'result-box show' + (isError ? ' error' : ' success');
        if (isError) {
          inner.innerHTML = '<div class="error-text">❌ ' + content + '</div>';
          return;
        }
        var fullUrl = window.location.origin + content;
        inner.innerHTML = '<div class="result-label">✅ 永久链接已生成</div>' +
          '<div class="result-link">' +
          '<a href="' + fullUrl + '" target="_blank">' + fullUrl + '</a>' +
          '<button class="copy-btn" id="copyBtn">复制</button>' +
          '</div>' +
          '<div style="margin-top:10px;font-size:12px;color:var(--text-tertiary);">此链接永久有效，可分享给任何人</div>';
        var copyBtn = inner.querySelector('#copyBtn');
        if (copyBtn) {
          copyBtn.addEventListener('click', function() {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(fullUrl).then(function() {
                copyBtn.textContent = '已复制!';
                setTimeout(function() { copyBtn.textContent = '复制'; }, 2000);
              });
            } else {
              prompt('请手动复制链接：', fullUrl);
            }
          });
        }
      }

      // 通用上传函数
      async function generateLink(formData, resultElement) {
        resultElement.classList.remove('show');
        var inner = resultElement.querySelector('.result-inner') || resultElement;
        inner.innerHTML = '<div style="padding:12px 0;color:var(--text-tertiary);">⏳ 生成中...</div>';
        resultElement.className = 'result-box show';
        try {
          var response = await fetch(formData.url, {
            method: 'POST',
            body: formData.body
          });
          var data = await response.json();
          if (data.success) {
            showResult(resultElement, data.url);
          } else {
            showResult(resultElement, data.error || '生成失败', true);
          }
        } catch (e) {
          showResult(resultElement, '网络错误，请重试', true);
        }
      }

      // URL上传
      document.getElementById('urlBtn').addEventListener('click', function() {
        var urlInput = document.getElementById('urlInput').value.trim();
        if (!urlInput) { showResult(document.getElementById('urlResult'), '请输入有效的 URL', true); return; }
        try { new URL(urlInput); } catch(err) { showResult(document.getElementById('urlResult'), 'URL 格式无效', true); return; }
        var formData = new FormData();
        formData.append('url', urlInput);
        generateLink({ url: '/ymzz/upload-url', body: formData }, document.getElementById('urlResult'));
      });

      // 代码上传
      document.getElementById('codeBtn').addEventListener('click', function() {
        var code = document.getElementById('codeInput').value.trim();
        if (!code) { showResult(document.getElementById('codeResult'), '请粘贴 HTML 代码', true); return; }
        var formData = new FormData();
        formData.append('code', code);
        generateLink({ url: '/ymzz/upload-code', body: formData }, document.getElementById('codeResult'));
      });

      // 文件上传
      var dropZone = document.getElementById('dropZone');
      var fileInput = document.getElementById('fileInput');
      var fileName = document.getElementById('fileName');
      var uploadBtn = document.getElementById('uploadBtn');
      var selectedFile = null;

      dropZone.addEventListener('click', function() { fileInput.click(); });
      dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('dragover'); });
      dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('dragover'); });
      dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', function(e) {
        if (e.target.files.length > 0) handleFile(e.target.files[0]);
      });

      function handleFile(file) {
        var allowed = ['html', 'htm', 'txt'];
        var ext = file.name.split('.').pop().toLowerCase();
        if (!allowed.includes(ext)) {
          alert('仅支持 .html / .htm / .txt 文件');
          return;
        }
        selectedFile = file;
        fileName.textContent = '✅ ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
        uploadBtn.disabled = false;
        document.getElementById('uploadResult').classList.remove('show');
      }

      uploadBtn.addEventListener('click', function() {
        if (!selectedFile) return;
        var formData = new FormData();
        formData.append('file', selectedFile);
        generateLink({ url: '/ymzz/upload-file', body: formData }, document.getElementById('uploadResult'));
      });
    });
  </script>
</body>
</html>`;
}