//
//配合tvbox_woker.js
//
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 处理跨域预检请求 (OPTIONS)
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

    // 2. 处理推送接口 (POST /api/push)
    if (request.method === 'POST' && path === '/api/push') {
      try {
        const dataJson = await request.json();
        const content = dataJson.content;
        const format = dataJson.format;
        const slug = dataJson.slug;

        if (!content || content.trim() === '') {
          throw new Error('推送内容不能为空');
        }

        let id = (slug && slug.trim() !== '') ? slug.trim() : Math.random().toString(36).substring(2, 10);
        if (env.FIXED_SLUG && env.FIXED_SLUG.trim() !== '') {
          id = env.FIXED_SLUG.trim();
        }

        await env.SUB_KV.put(id, content, { 
          metadata: { format: format || 'text' } 
        });

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

    // 3. 处理拉取/访问内容 (GET /:slug)
    const match = path.match(/^\/([a-zA-Z0-9_-]+)$/);
    if (request.method === 'GET' && match) {
      const slug = match[1];
      const kvData = await env.SUB_KV.getWithMetadata(slug);
      const value = kvData.value;
      const metadata = kvData.metadata;

      if (value === null) {
        return new Response('Not Found or Expired', {
          status: 404,
          headers: { 
            'Content-Type': 'text/plain; charset=utf-8',
            'Access-Control-Allow-Origin': '*' 
          }
        });
      }

      let ctype = 'text/plain';
      const fmt = metadata ? metadata.format : 'text';
      if (fmt === 'm3u') {
        ctype = 'application/vnd.apple.mpegurl';
      } else if (fmt === 'json') {
        ctype = 'application/json';
      }

      return new Response(value, {
        headers: {
          'Content-Type': ctype + '; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 4. 根目录 (GET /) - 返回管理面板 HTML
    if (path === '/' && request.method === 'GET') {
      const html = '<!DOCTYPE html>\n' +
'<html lang="zh-CN">\n' +
'<head>\n' +
'    <meta charset="UTF-8">\n' +
'    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'    <title>SubPush · Cloudflare 推送面板</title>\n' +
'    <style>\n' +
'        :root {\n' +
'            --bg: #0b0b14; --surface: #13131f; --surface2: #1c1c2c;\n' +
'            --text: #e4e4f0; --text2: #9a9ab8; --accent: #7c6ff0;\n' +
'            --accent2: #00d2a0; --danger: #ff5e7a; --border: #2a2a40;\n' +
'            --radius: 16px; --radius-sm: 10px;\n' +
'        }\n' +
'        * { margin:0; padding:0; box-sizing:border-box; }\n' +
'        body {\n' +
'            background: var(--bg); color: var(--text);\n' +
'            font-family: system-ui, -apple-system, sans-serif;\n' +
'            min-height: 100vh; display: flex; justify-content: center;\n' +
'            align-items: flex-start; padding: 24px;\n' +
'        }\n' +
'        .app-container { width: 100%; max-width: 720px; display: flex; flex-direction: column; gap: 24px; }\n' +
'        .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 28px 26px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }\n' +
'        .header { text-align: center; margin-bottom: 20px; }\n' +
'        .header h1 { font-size: 1.9em; font-weight: 700; background: linear-gradient(135deg, #a78bfa, #34d399); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }\n' +
'        .header p { font-size: 0.85em; color: var(--text2); margin-top: 4px; }\n' +
'        .field { margin-bottom: 18px; }\n' +
'        .field label { display: block; font-size: 0.8em; font-weight: 600; color: var(--text2); margin-bottom: 6px; }\n' +
'        input, textarea, select {\n' +
'            width: 100%; padding: 12px 16px; background: var(--surface2);\n' +
'            border: 1px solid var(--border); border-radius: var(--radius-sm);\n' +
'            color: var(--text); font-size: 0.95em; outline: none;\n' +
'        }\n' +
'        input:focus, textarea:focus, select:focus { border-color: var(--accent); }\n' +
'        textarea { min-height: 160px; resize: vertical; font-family: monospace; }\n' +
'        .row { display: flex; gap: 12px; align-items: flex-end; }\n' +
'        .row .field { flex:1; margin-bottom:0; }\n' +
'        .btn {\n' +
'            background: var(--accent); color: #fff; border: none;\n' +
'            border-radius: var(--radius-sm); padding: 13px 24px; font-size: 1em;\n' +
'            font-weight: 600; cursor: pointer; width: 100%;\n' +
'            display: flex; align-items: center; justify-content: center; gap: 8px;\n' +
'        }\n' +
'        .btn:disabled { opacity: 0.5; cursor: not-allowed; }\n' +
'        .status-msg { margin-top: 12px; font-size: 0.85em; min-height: 22px; }\n' +
'        .status-msg.success { color: var(--accent2); }\n' +
'        .status-msg.error { color: var(--danger); }\n' +
'        .result-inline { margin-top: 18px; padding: 16px; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-sm); display: none; }\n' +
'        .result-inline.show { display: block; }\n' +
'        .result-link { color: var(--accent2); font-family: monospace; word-break: break-all; margin: 8px 0; display: block; }\n' +
'        .qr-mini { text-align:center; margin:10px 0; }\n' +
'        .qr-mini img { border-radius:8px; background:#fff; padding:6px; max-width:120px; }\n' +
'        .inline-btns { display:flex; gap:8px; margin-top:10px; }\n' +
'        .inline-btns button { flex:1; padding:8px; background: var(--surface); border:1px solid var(--border); color:var(--text); border-radius:6px; cursor:pointer; }\n' +
'        .inline-btns .copy-btn { background: var(--accent2); color:#0b0b14; border:none; }\n' +
'        .history-card .history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }\n' +
'        .history-list { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }\n' +
'        .history-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--surface2); border-radius: var(--radius-sm); cursor: pointer; }\n' +
'        .h-info { flex: 1; min-width: 0; }\n' +
'        .h-id { font-weight: 600; color: #c4b5fd; font-family: monospace; }\n' +
'        .h-meta { font-size: 0.7em; color: var(--text2); margin-top: 2px; }\n' +
'        .empty-history { text-align: center; color: var(--text2); padding: 24px; }\n' +
'        .domain-row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }\n' +
'        .domain-row input { flex: 1; }\n' +
'        .domain-row button { width: auto; padding: 12px 16px; background: var(--surface2); border: 1px solid var(--border); color: var(--text); border-radius: var(--radius-sm); cursor: pointer; }\n' +
'        .domain-status { font-size: 0.8em; min-height: 20px; margin-bottom: 12px; }\n' +
'    </style>\n' +
'</head>\n' +
'<body>\n' +
'    <div class="app-container">\n' +
'        <div class="card">\n' +
'            <div class="header">\n' +
'                <h1>📡 SubPush</h1>\n' +
'                <p>一键推送直播源码 · 支持 TXT / M3U / JSON</p>\n' +
'            </div>\n' +
'            <div class="field">\n' +
'                <label>🔗 WORKER域名</label>\n' +
'                <div class="domain-row">\n' +
'                    <input type="text" id="domainInput" placeholder="sub.yourdomain.com">\n' +
'                    <button id="testBtn">🔍 测试</button>\n' +
'                </div>\n' +
'                <div class="domain-status" id="domainStatus"></div>\n' +
'            </div>\n' +
'            <div class="field">\n' +
'                <label>📝 源码内容</label>\n' +
'                <textarea id="contentInput" placeholder="在此粘贴内容..."></textarea>\n' +
'                <div style="display:flex; justify-content:space-between; font-size:0.7em; color:var(--text2); margin-top:4px;">\n' +
'                    <span id="charCount">0 字符</span>\n' +
'                </div>\n' +
'            </div>\n' +
'            <div class="row">\n' +
'                <div class="field">\n' +
'                    <label>📋 内容格式</label>\n' +
'                    <select id="formatSelect">\n' +
'                        <option value="text">文本文档(txt)</option>\n' +
'                        <option value="m3u">直播源(M3U)</option>\n' +
'                        <option value="json">JSON (TVBOX)</option>\n' +
'                    </select>\n' +
'                </div>\n' +
'                <div class="field">\n' +
'                    <label>🏷 自定义 ID (可选)</label>\n' +
'                    <input type="text" id="slugInput" placeholder="例如 mylist" maxlength="64">\n' +
'                </div>\n' +
'            </div>\n' +
'            <button class="btn" id="pushBtn" style="margin-top:18px;">🚀 推送到KV</button>\n' +
'            <div class="status-msg" id="statusMsg"></div>\n' +
'            <div class="result-inline" id="resultInline">\n' +
'                <div style="color:var(--accent2);"><strong>✅ 推送成功</strong></div>\n' +
'                <a class="result-link" id="resultLink" href="#" target="_blank"></a>\n' +
'                <div class="qr-mini" id="qrContainer"></div>\n' +
'                <div class="inline-btns">\n' +
'                    <button class="copy-btn" id="copyBtn">📋 复制链接</button>\n' +
'                    <button id="openBtn" style="display:none;">🔗 打开测试</button>\n' +
'                </div>\n' +
'            </div>\n' +
'        </div>\n' +
'        <div class="card history-card">\n' +
'            <div class="history-header">\n' +
'                <h2>📜 推送历史</h2>\n' +
'                <button id="clearHistoryBtn" style="background:none; border:1px solid var(--border); color:var(--text2); padding:4px 10px; border-radius:12px; cursor:pointer;">🗑 清空</button>\n' +
'            </div>\n' +
'            <div class="history-list" id="historyList">\n' +
'                <div class="empty-history">暂无推送记录</div>\n' +
'            </div>\n' +
'        </div>\n' +
'    </div>\n' +
'    <script>\n' +
'        (function() {\n' +
'            const domainInput = document.getElementById("domainInput");\n' +
'            const contentInput = document.getElementById("contentInput");\n' +
'            const pushBtn = document.getElementById("pushBtn");\n' +
'            const statusMsg = document.getElementById("statusMsg");\n' +
'            const resultInline = document.getElementById("resultInline");\n' +
'            const resultLink = document.getElementById("resultLink");\n' +
'            const qrContainer = document.getElementById("qrContainer");\n' +
'            const copyBtn = document.getElementById("copyBtn");\n' +
'            const openBtn = document.getElementById("openBtn");\n' +
'            const slugInput = document.getElementById("slugInput");\n' +
'            const charCount = document.getElementById("charCount");\n' +
'            const formatSelect = document.getElementById("formatSelect");\n' +
'            const historyList = document.getElementById("historyList");\n' +
'            const clearHistoryBtn = document.getElementById("clearHistoryBtn");\n' +
'            const testBtn = document.getElementById("testBtn");\n' +
'            const domainStatus = document.getElementById("domainStatus");\n' +
'\n' +
'            domainInput.value = window.location.host;\n' +
'\n' +
'            function getBaseUrl() {\n' +
'                let domain = domainInput.value.trim();\n' +
'                if (!domain) return null;\n' +
'                domain = domain.replace(/^https?:\\/\\//i, "").replace(/\\/+$/, "");\n' +
'                return "https://" + domain;\n' +
'            }\n' +
'\n' +
'            contentInput.addEventListener("input", function() {\n' +
'                charCount.textContent = contentInput.value.length + " 字符";\n' +
'            });\n' +
'\n' +
'            testBtn.addEventListener("click", async function() {\n' +
'                const base = getBaseUrl();\n' +
'                if (!base) { domainStatus.textContent = "❌ 请输入域名"; domainStatus.style.color = "var(--danger)"; return; }\n' +
'                testBtn.disabled = true;\n' +
'                domainStatus.textContent = "⏳ 正在测试连接...";\n' +
'                domainStatus.style.color = "var(--text2)";\n' +
'                try {\n' +
'                    const resp = await fetch(base + "/", { method: "GET" });\n' +
'                    if (resp.ok) {\n' +
'                        domainStatus.textContent = "✅ 节点连接正常！";\n' +
'                        domainStatus.style.color = "var(--accent2)";\n' +
'                    } else {\n' +
'                        domainStatus.textContent = "⚠️ 节点响应异常 (HTTP " + resp.status + ")";\n' +
'                        domainStatus.style.color = "var(--danger)";\n' +
'                    }\n' +
'                } catch (e) {\n' +
'                    domainStatus.textContent = "❌ 无法连接到节点";\n' +
'                    domainStatus.style.color = "var(--danger)";\n' +
'                } finally {\n' +
'                    testBtn.disabled = false;\n' +
'                }\n' +
'            });\n' +
'\n' +
'            function loadHistory() {\n' +
'                try { return JSON.parse(localStorage.getItem("subpush_history") || "[]"); } catch { return []; }\n' +
'            }\n' +
'            function saveHistory(entry) {\n' +
'                const history = loadHistory();\n' +
'                history.unshift(entry);\n' +
'                localStorage.setItem("subpush_history", JSON.stringify(history.slice(0, 30)));\n' +
'            }\n' +
'            function renderHistory() {\n' +
'                const history = loadHistory();\n' +
'                if (history.length === 0) {\n' +
'                    historyList.innerHTML = \'<div class="empty-history">暂无推送记录</div>\';\n' +
'                    return;\n' +
'                }\n' +
'                historyList.innerHTML = history.map(function(h) {\n' +
'                    const fullUrl = h.base + "/" + h.id;\n' +
'                    return \'<div class="history-item" data-url="\' + fullUrl + \'">\' +\n' +
'                           \'<div class="h-info"><div class="h-id">\' + h.id + \'</div><div class="h-meta">\' + h.format.toUpperCase() + \'</div></div>\' +\n' +
'                           \'</div>\';\n' +
'                }).join("");\n' +
'                \n' +
'                // 绑定点击历史记录跳转事件\n' +
'                const items = historyList.querySelectorAll(".history-item");\n' +
'                items.forEach(function(item) {\n' +
'                    item.addEventListener("click", function() {\n' +
'                        window.open(item.getAttribute("data-url"), "_blank");\n' +
'                    });\n' +
'                });\n' +
'            }\n' +
'\n' +
'            pushBtn.addEventListener("click", async function() {\n' +
'                const base = getBaseUrl();\n' +
'                if (!base) { statusMsg.textContent = "❌ 请输入域名"; statusMsg.className = "status-msg error"; return; }\n' +
'                const content = contentInput.value.trim();\n' +
'                if (!content) { statusMsg.textContent = "❌ 请输入内容"; statusMsg.className = "status-msg error"; return; }\n' +
'                const format = formatSelect.value;\n' +
'                const slug = slugInput.value.trim();\n' +
'                const payload = { content: content, format: format };\n' +
'                if (slug) payload.slug = slug;\n' +
'                pushBtn.disabled = true;\n' +
'                statusMsg.textContent = "⏳ 正在推送...";\n' +
'                statusMsg.className = "status-msg";\n' +
'                resultInline.classList.remove("show");\n' +
'                try {\n' +
'                    const resp = await fetch(base + "/api/push", {\n' +
'                        method: "POST",\n' +
'                        headers: { "Content-Type": "application/json" },\n' +
'                        body: JSON.stringify(payload)\n' +
'                    });\n' +
'                    const data = await resp.json();\n' +
'                    if (!resp.ok || !data.success) throw new Error(data.error || "HTTP " + resp.status);\n' +
'                    const fullUrl = base + "/" + data.id;\n' +
'                    resultLink.href = fullUrl;\n' +
'                    resultLink.textContent = fullUrl;\n' +
'                    qrContainer.innerHTML = \'<img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=\' + encodeURIComponent(fullUrl) + \'" alt="QR">\';\n' +
'                    resultInline.classList.add("show");\n' +
'                    statusMsg.textContent = "✅ 推送成功！ID: " + data.id;\n' +
'                    statusMsg.className = "status-msg success";\n' +
'                    saveHistory({ base: base, id: data.id, format: format });\n' +
'                    renderHistory();\n' +
'                } catch (err) {\n' +
'                    statusMsg.textContent = "❌ 推送失败: " + err.message;\n' +
'                    statusMsg.className = "status-msg error";\n' +
'                } finally {\n' +
'                    pushBtn.disabled = false;\n' +
'                }\n' +
'            });\n' +
'\n' +
'            copyBtn.addEventListener("click", function() {\n' +
'                navigator.clipboard.writeText(resultLink.href).then(function() {\n' +
'                    copyBtn.textContent = "✅ 已复制";\n' +
'                    setTimeout(function() { copyBtn.textContent = "📋 复制链接"; }, 2000);\n' +
'                });\n' +
'            });\n' +
'\n' +
'            clearHistoryBtn.addEventListener("click", function() {\n' +
'                if (confirm("确定清空历史吗？")) {\n' +
'                    localStorage.removeItem("subpush_history");\n' +
'                    renderHistory();\n' +
'                }\n' +
'            });\n' +
'\n' +
'            renderHistory();\n' +
'        })();\n' +
'    </script>\n' +
'</body>\n' +
'</html>';

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    return new Response('Not Found', {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
};
