export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json;charset=UTF-8'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 1. GET /api/migrate — 创建数据表
    if (path === '/api/migrate' && request.method === 'GET') {
      try {
        await env.DB.prepare('DROP TABLE IF EXISTS contacts').run();
        await env.DB.prepare('DROP TABLE IF EXISTS page_visits').run();
        await env.DB.prepare('CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, company TEXT, message TEXT, timestamp TEXT NOT NULL)').run();
        await env.DB.prepare('CREATE TABLE page_visits (id INTEGER PRIMARY KEY AUTOINCREMENT, page_url TEXT NOT NULL, referrer TEXT, user_agent TEXT, screen_width INTEGER, screen_height INTEGER, language TEXT, ip TEXT, country TEXT, timestamp TEXT NOT NULL, visit_date TEXT NOT NULL)').run();
        return new Response(JSON.stringify({ success: true, message: '表已创建' }), {
          status: 200, headers: corsHeaders
        });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    // 2. POST /api/form — 提交表单
    if (path === '/api/form' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { name, email, phone, company, message } = body;
        if (!name || !email) {
          return new Response(JSON.stringify({ success: false, message: '姓名和邮箱为必填项' }), {
            status: 400, headers: corsHeaders
          });
        }
        const timestamp = new Date().toISOString();
        await env.DB.prepare('INSERT INTO contacts (name, email, phone, company, message, timestamp) VALUES (?, ?, ?, ?, ?, ?)').bind(name, email, phone || '', company || '', message || '', timestamp).run();
        return new Response(JSON.stringify({ success: true, message: '提交成功' }), {
          status: 201, headers: corsHeaders
        });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    // 3. GET /api/form — 查询表单（支持分页）
    if (path === '/api/form' && request.method === 'GET') {
      try {
        const page = parseInt(url.searchParams.get('page')) || 1;
        const pageSize = parseInt(url.searchParams.get('pageSize')) || 20;
        const offset = (page - 1) * pageSize;
        const totalRow = await env.DB.prepare('SELECT COUNT(*) as count FROM contacts').first();
        const total = totalRow.count;
        const { results } = await env.DB.prepare('SELECT * FROM contacts ORDER BY id DESC LIMIT ? OFFSET ?').bind(pageSize, offset).all();
        return new Response(JSON.stringify({
          success: true, contacts: results, count: results.length,
          total: total, page: page, pageSize: pageSize
        }), { status: 200, headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    // 4. POST /api/visit — 记录页面访问
    if (path === '/api/visit' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { page_url, referrer, user_agent, screen_width, screen_height, language } = body;
        const ip = request.headers.get('CF-Connecting-IP') || '';
        const country = request.headers.get('CF-IPCountry') || '';
        const timestamp = new Date().toISOString();
        const visit_date = timestamp.slice(0, 10);
        await env.DB.prepare('INSERT INTO page_visits (page_url, referrer, user_agent, screen_width, screen_height, language, ip, country, timestamp, visit_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(page_url || '/', referrer || '', user_agent || '', screen_width || 0, screen_height || 0, language || '', ip, country, timestamp, visit_date).run();
        return new Response(JSON.stringify({ success: true, message: '已记录' }), {
          status: 201, headers: corsHeaders
        });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    // 5. GET /api/visits/stats — 访问统计（支持 start/end 日期范围，无参数时返回全部）
    if (path === '/api/visits/stats' && request.method === 'GET') {
      try {
        const start = url.searchParams.get('start');
        const end = url.searchParams.get('end');
        let whereClause = '1=1';
        let bindParams = [];
        if (start && end) {
          whereClause = 'visit_date >= ? AND visit_date <= ?';
          bindParams = [start, end];
        } else if (start) {
          whereClause = 'visit_date >= ?';
          bindParams = [start];
        } else if (end) {
          whereClause = 'visit_date <= ?';
          bindParams = [end];
        }
        const total = await env.DB.prepare('SELECT COUNT(*) as count FROM page_visits WHERE ' + whereClause).bind(...bindParams).first();
        const unique = await env.DB.prepare('SELECT COUNT(DISTINCT ip) as count FROM page_visits WHERE ' + whereClause).bind(...bindParams).first();
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayTotal = await env.DB.prepare('SELECT COUNT(*) as count FROM page_visits WHERE visit_date = ?').bind(todayStr).first();
        const pages = await env.DB.prepare('SELECT page_url, COUNT(*) as count FROM page_visits WHERE ' + whereClause + ' GROUP BY page_url ORDER BY count DESC LIMIT 10').bind(...bindParams).all();
        const referrers = await env.DB.prepare("SELECT CASE WHEN referrer = '' OR referrer IS NULL THEN '直接访问' ELSE referrer END as source, COUNT(*) as count FROM page_visits WHERE " + whereClause + " GROUP BY source ORDER BY count DESC LIMIT 10").bind(...bindParams).all();
        const devices = await env.DB.prepare("SELECT CASE WHEN user_agent LIKE '%Mobile%' OR user_agent LIKE '%Android%' OR user_agent LIKE '%iPhone%' THEN '移动端' ELSE '桌面端' END as device, COUNT(*) as count FROM page_visits WHERE " + whereClause + " GROUP BY device").bind(...bindParams).all();
        const regions = await env.DB.prepare("SELECT CASE WHEN country = '' OR country IS NULL THEN '未知' ELSE country END as country, COUNT(*) as count FROM page_visits WHERE " + whereClause + " GROUP BY country ORDER BY count DESC").bind(...bindParams).all();
        const recent = await env.DB.prepare('SELECT id, page_url, ip, country, user_agent, timestamp FROM page_visits WHERE ' + whereClause + ' ORDER BY id DESC LIMIT 50').bind(...bindParams).all();
        return new Response(JSON.stringify({
          success: true, start: start || 'all', end: end || 'all',
          total_visits: total.count,
          unique_visitors: unique.count,
          today_visits: todayTotal.count,
          top_pages: pages.results,
          referrer_sources: referrers.results,
          device_distribution: devices.results,
          region_distribution: regions.results,
          recent_visits: recent.results
        }), { status: 200, headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    // 6. DELETE /api/form/clear — 清空测试数据
    if (path === '/api/form/clear' && request.method === 'DELETE') {
      try {
        await env.DB.prepare('DELETE FROM contacts').run();
        await env.DB.prepare('DELETE FROM page_visits').run();
        return new Response(JSON.stringify({ success: true, message: '已清空' }), {
          status: 200, headers: corsHeaders
        });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    // 7. GET /api/visits/list — 详细访问记录（支持日期范围 + 分页）
    if (path === '/api/visits/list' && request.method === 'GET') {
      try {
        const startDate = url.searchParams.get('start') || new Date().toISOString().slice(0, 10);
        const endDate = url.searchParams.get('end') || new Date().toISOString().slice(0, 10);
        const page = parseInt(url.searchParams.get('page')) || 1;
        const pageSize = parseInt(url.searchParams.get('pageSize')) || 50;
        const offset = (page - 1) * pageSize;
        const totalRow = await env.DB.prepare('SELECT COUNT(*) as count FROM page_visits WHERE visit_date >= ? AND visit_date <= ?').bind(startDate, endDate).first();
        const total = totalRow.count;
        const { results } = await env.DB.prepare('SELECT id, page_url, referrer, user_agent, screen_width, screen_height, language, ip, country, timestamp, visit_date FROM page_visits WHERE visit_date >= ? AND visit_date <= ? ORDER BY timestamp DESC LIMIT ? OFFSET ?').bind(startDate, endDate, pageSize, offset).all();
        return new Response(JSON.stringify({
          success: true,
          visits: results,
          count: results.length,
          total: total,
          page: page,
          pageSize: pageSize
        }), { status: 200, headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    // 8. 404
    return new Response(JSON.stringify({ success: false, error: 'Not Found' }), {
      status: 404, headers: corsHeaders
    });
  }
};