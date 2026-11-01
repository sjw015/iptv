/**
 * =====================================================================
 * 🇨🇳 国内全量聚合直播 - Cloudflare Worker (T4 影视壳 + IPTV M3U 双兼容旗舰版)
 * =====================================================================
 * * 🛠️【部署完成后 - 客户端导入格式模板说明】
 * * 👉 假设你部署完后的 Worker 域名是：https://china-live.xyz.workers.dev
 * * ---------------------------------------------------------------------
 * 1️⃣ M3U 格式导入模板 (适用于 APTV、iSTB、Fileball、PotPlayer 等 IPTV 播放器)
 * ---------------------------------------------------------------------
 * 直接在播放器软件中添加远程连接/M3U订阅，完整输入以下链接：
 * 🔗 订阅链接：https://china-live.xyz.workers.dev/live.m3u
 * （💡 提示：该链接会自动高并发提取各大平台当前最热的在线频道，全量直连）
 * * ---------------------------------------------------------------------
 * 2️⃣ T4 影视壳格式导入模板 (适用于 TVBox、海阔影视、影音壳子等影视壳客户端)
 * ---------------------------------------------------------------------
 * 💡 情况 A：如果客户端支持“直接添加单个 T4/自定义数据源”：
 * 🔗 API 地址直接填：https://china-live.xyz.workers.dev/
 * * 💡 情况 B：如果你是用自建的整包 JSON 配置文件，请将以下大括号代码复制到 "sites": [ ... ] 数组中：
 * {
 * "key": "china_live_aggregate",
 * "name": "🇨🇳 国内聚合直播",
 * "type": 4,
 * "api": "https://china-live.xyz.workers.dev/",
 * "searchable": 0,
 * "quickSearch": 0,
 * "filterable": 0
 * }
 * =====================================================================
 */

const HOST = "http://api.hclyz.com:81/mf";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const params = url.searchParams;

        const m3uHeaders = {
            "Content-Type": "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
        };

        const corsHeaders = {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*"
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            let action = params.get("ac") || path.replace("/", "");
            let tid = params.get("tid") || params.get("t") || "";
            let pg = params.get("pg") || params.get("page") || "1";

            // ==========================================
            // 路由 1：高性能 M3U 极速全量聚合列表
            // ==========================================
            if (action === "live.m3u" || action === "m3u" || path.endsWith(".m3u")) {
                const m3uString = await handleM3U();
                return new Response(m3uString, { headers: m3uHeaders });
            }

            // ==========================================
            // 路由 2：T4 影视壳标准业务逻辑组件
            // ==========================================
            if (tid) {
                return new Response(JSON.stringify(await handleCategory(tid)), { headers: corsHeaders });
            }

            if (action === "detail" || params.get("ids")) {
                let ids = params.get("ids") || "";
                return new Response(JSON.stringify(await handleDetail(ids)), { headers: corsHeaders });
            }

            if (action === "play") {
                let id = params.get("id") || "";
                return new Response(JSON.stringify(await handlePlay(id)), { headers: corsHeaders });
            }

            // 根路由：动态加载所有平台作为独立“分类”
            return new Response(JSON.stringify(await handleHome()), { headers: corsHeaders });

        } catch (err) {
            return new Response(JSON.stringify({ "list": [], "msg": err.message }), { 
                status: 500, 
                headers: corsHeaders 
            });
        }
    }
};

/**
 * 核心分类引擎：实时拉取 json.txt 并动态将其中的每个独立平台平铺为 T4 独立分类
 */
async function handleHome() {
    try {
        const res = await fetch(`${HOST}/json.txt`, { headers: { "User-Agent": UA } });
        const json = await res.json();
        const data = json.pingtai || [];
        
        // 遵循原 Python 逻辑跳过第0项(通常为公告广告)，并将其余所有平台全部展示为 T4 分类
        const classes = data.slice(1).map(item => {
            return {
                "type_id": item.address, // 将平台的数据地址文件作为 tid (例如: "am.txt")
                "type_name": item.title  // 平台名称作为分类显示
            };
        });
        
        return { "class": classes };
    } catch (e) {
        return { "class": [{ "type_id": "json.txt", "type_name": "⚠️ 列表加载失败" }] };
    }
}

/**
 * 核心二级列表：点击进入某个平台后，将其内部的所有主播作为“视频卡片”平铺展示
 */
async function handleCategory(tid) {
    try {
        // 请求对应平台的具体主播 JSON 列表
        const res = await fetch(`${HOST}/${tid}`, { headers: { "User-Agent": UA } });
        const json = await res.json();
        const zhubo = json.zhubo || [];

        const videos = zhubo.map(vod => {
            // 将主播名与直播流物理地址进行安全编码整合，在二级页面就封死数据，防止三级详情页重复请求接口
            const packId = btoa(encodeURIComponent(`${vod.title}|||${vod.address}`));
            return {
                "vod_id": packId,
                "vod_name": vod.title,
                "vod_pic": "https://raw.githubusercontent.com/fish2018/lib/refs/heads/main/imgs/live.png",
                "vod_remarks": "📡 在线直播中"
            };
        });

        return {
            "page": 1,
            "pagecount": 1,
            "limit": videos.length,
            "total": videos.length,
            "list": videos
        };
    } catch (e) {
        return { "list": [] };
    }
}

/**
 * 详情页解密组件：直接解析在二级列表中打包好的流媒体地址，实现零开销秒响应
 */
async function handleDetail(ids) {
    try {
        const decoded = decodeURIComponent(atob(ids));
        const [title, address] = decoded.split("|||");
        
        return {
            "list": [{
                "vod_id": ids,
                "vod_name": title,
                "vod_pic": "",
                "vod_remarks": "国内大秀",
                "vod_content": `欢迎观赏国内聚合直播大秀，当前主播：${title}。全量超低延迟流媒体架构开发，技术发布源：TG频道 @stymei。`,
                "vod_play_from": "✈️ 頻道@stymei",
                "vod_play_url": `原生原画高清流$${address}`
            }]
        };
    } catch (e) {
        return { "list": [] };
    }
}

/**
 * 播放组件：因为上游接口给的就是直连流，直接返回 parse: 0 让客户端完成播放
 */
async function handlePlay(id) {
    return {
        "parse": 0,
        "url": id
    };
}

/**
 * M3U 高性能并发聚合生成器：智能调配并发流，将所有平台的分类和频道完美输出为标准的 IPTV 列表
 */
async function handleM3U() {
    let m3uResult = "#EXTM3U x-tvg-url=\"\"\n";
    try {
        const res = await fetch(`${HOST}/json.txt`, { headers: { "User-Agent": UA } });
        const json = await res.json();
        const platforms = (json.pingtai || []).slice(1);
        
        // 根据各平台的人数/热度(Number属性)进行降序排列，优先展示热度最高的平台
        platforms.sort((a, b) => parseInt(b.Number || 0) - parseInt(a.Number || 0));
        
        // 精确裁切前 24 个最优质的分类平台，严格卡死在 Cloudflare 50 次子请求配额以内，绝对不报错
        const topPlatforms = platforms.slice(0, 24);
        
        // 采用高速异步流并发请求所有分类的主播数据
        const promises = topPlatforms.map(async (p) => {
            try {
                const subRes = await fetch(`${HOST}/${p.address}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(4000) });
                const subJson = await subRes.json();
                
                // 处理原图片替换策略，完美兼容防盗链或资源重定向
                let platformLogo = p.xinimg.replace(
                    "http://cdn.gcufbd.top/img/",
                    "https://slink.ltd/https://raw.githubusercontent.com/fish2018/lib/refs/heads/main/imgs/"
                );
                
                return {
                    platformTitle: p.title,
                    platformLogo: platformLogo,
                    anchors: subJson.zhubo || []
                };
            } catch (err) {
                return null;
            }
        });
        
        const results = await Promise.all(promises);
        
        // 遍历并压入 M3U 格式化文本
        results.forEach(item => {
            if (!item) return;
            item.anchors.forEach(vod => {
                m3uResult += `#EXTINF:-1 tvg-logo="${item.platformLogo}" group-title="${item.platformTitle}",${vod.title}\n`;
                m3uResult += `${vod.address}\n`;
            });
        });
        
    } catch (e) {
        m3uResult += `#EXTINF:-1 group-title="错误",网络列表加载失败\nhttp://0.0.0.0\n`;
    }
    return m3uResult;
}