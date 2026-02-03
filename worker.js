// 修正版 Worker 代码
const getConfig = (env) => ({
  ADMIN_USERNAME: env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || 'admin123',
  DEFAULT_INTERVAL: 24,
  KEYS: {
    CONFIGS: 'iptv_configs',
    FILES: 'file_',
    INTERVAL: 'download_interval',
    SESSION: 'admin_session_'
  }
});

// 使用简单的函数替代类，避免this上下文问题
async function getAllConfigs(kv, config) {
  const configs = await kv.get(config.KEYS.CONFIGS, 'json');
  return configs || [];
}

async function saveConfigs(kv, config, configs) {
  await kv.put(config.KEYS.CONFIGS, JSON.stringify(configs));
}

async function getInterval(kv, config) {
  const interval = await kv.get(config.KEYS.INTERVAL, 'text');
  return interval ? parseInt(interval) : config.DEFAULT_INTERVAL;
}

async function setInterval(kv, config, hours) {
  await kv.put(config.KEYS.INTERVAL, hours.toString());
}

async function downloadFile(kv, config, fileConfig) {
  try {
    const response = await fetch(fileConfig.sourceUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const content = await response.text();
    const kvKey = `${config.KEYS.FILES}${fileConfig.directoryName}`;
    
    // 保存文件内容
    await kv.put(kvKey, content);
    
    // 更新最后更新时间
    const now = new Date().toISOString();
    const configs = await getAllConfigs(kv, config);
    const index = configs.findIndex(c => c.directoryName === fileConfig.directoryName);
    
    if (index !== -1) {
      configs[index].lastUpdated = now;
      await saveConfigs(kv, config, configs);
    }
    
    // 记录成功日志
    await addLog(kv, 'info', `成功下载: ${fileConfig.directoryName} (${fileConfig.sourceUrl})`);
    
    return { success: true, content };
  } catch (error) {
    await addLog(kv, 'error', `下载失败 ${fileConfig.directoryName}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function addLog(kv, type, message) {
  try {
    const logsJson = await kv.get('logs', 'json');
    const logs = logsJson || [];
    logs.unshift({
      time: new Date().toISOString(),
      type,
      message
    });
    // 只保留最近100条日志
    if (logs.length > 100) logs.length = 100;
    await kv.put('logs', JSON.stringify(logs));
  } catch (error) {
    console.error('记录日志失败:', error);
  }
}

async function getLogs(kv) {
  const logs = await kv.get('logs', 'json');
  return logs || [];
}

// 辅助函数
function getMimeType(ext) {
  const mimeTypes = {
    'm3u': 'audio/x-mpegurl',
    'm3u8': 'application/vnd.apple.mpegurl',
    'txt': 'text/plain',
    'json': 'application/json',
    'xml': 'application/xml'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function generateSessionId(username) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2);
  return btoa(`${username}:${timestamp}:${random}`).replace(/[=+/]/g, '');
}

async function checkAuth(request, kv, config) {
  try {
    const cookie = request.headers.get('Cookie');
    if (!cookie) return false;
    
    const sessionMatch = cookie.match(/admin_session=([^;]+)/);
    if (!sessionMatch) return false;
    
    const sessionId = sessionMatch[1];
    const sessionKey = `${config.KEYS.SESSION}${sessionId}`;
    
    // 从KV获取会话数据
    const sessionData = await kv.get(sessionKey, 'json');
    if (!sessionData) return false;
    
    // 验证会话有效性（7天内有效）
    const sessionAge = Date.now() - sessionData.loginTime;
    if (sessionAge > 7 * 24 * 60 * 60 * 1000) {
      await kv.delete(sessionKey);
      return false;
    }
    
    // 更新会话时间（滑动过期）
    sessionData.loginTime = Date.now();
    await kv.put(sessionKey, JSON.stringify(sessionData), { expirationTtl: 604800 });
    
    return true;
  } catch (error) {
    return false;
  }
}

async function getCurrentUsername(request, kv, config) {
  try {
    const cookie = request.headers.get('Cookie');
    if (!cookie) return null;
    
    const sessionMatch = cookie.match(/admin_session=([^;]+)/);
    if (!sessionMatch) return null;
    
    const sessionId = sessionMatch[1];
    const sessionKey = `${config.KEYS.SESSION}${sessionId}`;
    
    const sessionData = await kv.get(sessionKey, 'json');
    return sessionData ? sessionData.username : null;
  } catch (error) {
    return null;
  }
}

// HTML 模板（简化版）
const HTML_TEMPLATES = {
  mainPage: (configs, lastUpdated, interval, adminUsername) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IPTV直播源服务</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; max-width: 1200px; margin: 0 auto; }
        .card { border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
        .config-list { margin-top: 20px; }
        .config-item { padding: 10px; border-bottom: 1px solid #eee; }
    </style>
</head>
<body>
    <h1>📺 IPTV直播源服务</h1>
    
    <div class="card">
        <h2>系统状态</h2>
        <p><strong>直播源数量:</strong> ${configs.length}</p>
        <p><strong>最后更新:</strong> ${lastUpdated || '从未更新'}</p>
        <p><strong>更新间隔:</strong> ${interval}小时</p>
        <p><a href="/admin" class="btn">管理后台</a></p>
    </div>
    
    <div class="card">
        <h2>直播源列表</h2>
        ${configs.length > 0 ? `
        <div class="config-list">
            ${configs.map(config => `
            <div class="config-item">
                <h3>${config.directoryName}</h3>
                <p><strong>文件:</strong> <a href="/${config.directoryName}/iptv.${config.extension}">/${config.directoryName}/iptv.${config.extension}</a></p>
                <p><strong>最后更新:</strong> ${config.lastUpdated || '未下载'}</p>
            </div>
            `).join('')}
        </div>
        ` : '<p>暂无直播源配置，请前往管理后台添加。</p>'}
    </div>
</body>
</html>
  `,

  loginPage: () => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理员登录</title>
    <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .login-box { width: 300px; padding: 30px; border: 1px solid #ddd; border-radius: 10px; }
        input { width: 100%; padding: 10px; margin: 10px 0; }
        button { width: 100%; padding: 10px; background: #007bff; color: white; border: none; }
        .error { color: red; display: none; }
    </style>
</head>
<body>
    <div class="login-box">
        <h2>管理员登录</h2>
        <form id="loginForm">
            <input type="text" id="username" placeholder="用户名" required>
            <input type="password" id="password" placeholder="密码" required>
            <button type="submit">登录</button>
        </form>
        <div id="error" class="error">用户名或密码错误</div>
    </div>
    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            const response = await fetch('/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            if (response.ok) {
                window.location.href = '/admin/dashboard';
            } else {
                document.getElementById('error').style.display = 'block';
            }
        });
    </script>
</body>
</html>
  `
};

// Worker 主处理函数
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const config = getConfig(env);
      const kv = env.IPTV_STORE; // 直接使用 kv 变量

      // 验证 KV 是否已绑定
      if (!kv) {
        throw new Error('KV 存储未正确绑定。请检查 wrangler.toml 配置。');
      }

      console.log(`访问路径: ${path}`);

      // 1. 根路径 - 显示主页
      if (path === '/') {
        const configs = await getAllConfigs(kv, config);
        const lastUpdated = configs.length > 0 
          ? configs.reduce((latest, c) => {
              if (!c.lastUpdated) return latest;
              const currentDate = new Date(c.lastUpdated);
              const latestDate = new Date(latest);
              return currentDate > latestDate ? c.lastUpdated : latest;
            }, '1970-01-01T00:00:00.000Z') 
          : null;
        
        const interval = await getInterval(kv, config);
        
        return new Response(
          HTML_TEMPLATES.mainPage(configs, lastUpdated, interval, null),
          { headers: { 'Content-Type': 'text/html' } }
        );
      }

      // 2. 文件访问路径 - /目录名/iptv.扩展名
      const fileMatch = path.match(/^\/([^\/]+)\/iptv\.([^\/]+)$/);
      if (fileMatch) {
        const [, dirName, ext] = fileMatch;
        const configs = await getAllConfigs(kv, config);
        const fileConfig = configs.find(c => c.directoryName === dirName && c.extension === ext);
        
        if (!fileConfig) {
          return new Response('文件不存在', { status: 404 });
        }
        
        const fileContent = await kv.get(`${config.KEYS.FILES}${dirName}`);
        
        if (!fileContent) {
          return new Response('文件尚未生成，请等待定时任务下载', { status: 404 });
        }
        
        return new Response(fileContent, {
          headers: {
            'Content-Type': getMimeType(ext),
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }

      // 3. 管理后台相关路径
      if (path.startsWith('/admin')) {
        return await handleAdminRoutes(request, env, kv, config, path, ctx);
      }

      return new Response('页面未找到', { status: 404 });
      
    } catch (error) {
      console.error('Worker Error:', error);
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head><title>错误</title></head>
        <body>
          <h1>错误详情</h1>
          <p><strong>消息:</strong> ${error.message}</p>
          <p><strong>堆栈:</strong> ${error.stack}</p>
        </body>
        </html>
      `, {
        status: 500,
        headers: { 'Content-Type': 'text/html' }
      });
    }
  },

  // 定时任务处理
  async scheduled(event, env, ctx) {
    console.log('定时任务开始');
    
    const config = getConfig(env);
    const kv = env.IPTV_STORE;
    
    if (!kv) {
      console.error('KV 未绑定，定时任务终止');
      return;
    }
    
    const configs = await getAllConfigs(kv, config);
    const interval = await getInterval(kv, config);
    
    await kv.put('last_scheduled_check', new Date().toISOString());
    
    console.log(`开始处理 ${configs.length} 个配置`);
    
    for (const configItem of configs) {
      await downloadFile(kv, config, configItem);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('定时任务完成');
  }
};

// 处理管理后台路由（单独函数）
async function handleAdminRoutes(request, env, kv, config, path, ctx) {
  // 退出登录
  if (path === '/admin/logout') {
    const headers = new Headers();
    headers.append('Set-Cookie', 'admin_session=; HttpOnly; Path=/admin; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    return new Response('正在退出...', {
      headers,
      status: 302,
      headers: { 'Location': '/admin' }
    });
  }

  // 登录页面
  if (path === '/admin') {
    return new Response(HTML_TEMPLATES.loginPage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // 处理登录
  if (path === '/admin/login' && request.method === 'POST') {
    try {
      const { username, password } = await request.json();
      
      if (username === config.ADMIN_USERNAME && password === config.ADMIN_PASSWORD) {
        // 生成会话令牌
        const sessionId = generateSessionId(username);
        const sessionData = {
          username,
          loginTime: Date.now(),
          userAgent: request.headers.get('User-Agent')
        };
        
        // 存储会话到KV（7天有效期）
        await kv.put(
          `${config.KEYS.SESSION}${sessionId}`,
          JSON.stringify(sessionData),
          { expirationTtl: 604800 }
        );
        
        const headers = new Headers();
        headers.append('Set-Cookie', `admin_session=${sessionId}; HttpOnly; Path=/admin; Max-Age=604800; SameSite=Strict`);
        return new Response(JSON.stringify({ success: true }), { headers });
      }
      
      return new Response(JSON.stringify({ 
        success: false, 
        error: '用户名或密码错误' 
      }), { status: 401 });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '登录请求格式错误' 
      }), { status: 400 });
    }
  }

  // 检查认证
  const isAuthenticated = await checkAuth(request, kv, config);
  if (!isAuthenticated && path !== '/admin' && path !== '/admin/login') {
    return Response.redirect(new URL('/admin', request.url), 302);
  }

  // 管理仪表板
  if (path === '/admin/dashboard') {
    const configs = await getAllConfigs(kv, config);
    const interval = await getInterval(kv, config);
    const lastCheck = await kv.get('last_scheduled_check', 'text');
    
    const adminUsername = await getCurrentUsername(request, kv, config);
    
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理后台</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .card { border: 1px solid #ddd; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .btn { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 10px; }
    </style>
</head>
<body>
    <h1>管理后台</h1>
    <p>管理员: ${adminUsername} | <a href="/admin/logout">退出</a> | <a href="/">返回首页</a></p>
    
    <div class="card">
        <h2>添加新直播源</h2>
        <form id="addForm">
            <input type="text" name="directoryName" placeholder="目录名" required><br>
            <input type="url" name="sourceUrl" placeholder="源URL" required><br>
            <select name="extension">
                <option value="m3u">m3u</option>
                <option value="m3u8">m3u8</option>
                <option value="txt">txt</option>
            </select><br>
            <button type="submit" class="btn">添加</button>
        </form>
    </div>
    
    <div class="card">
        <h2>现有配置 (${configs.length})</h2>
        <table>
            <tr><th>目录名</th><th>源地址</th><th>扩展名</th><th>最后更新</th><th>操作</th></tr>
            ${configs.map(c => `
            <tr>
                <td>${c.directoryName}</td>
                <td>${c.sourceUrl}</td>
                <td>${c.extension}</td>
                <td>${c.lastUpdated || '未下载'}</td>
                <td>
                    <button onclick="updateSource('${c.directoryName}')" class="btn">更新</button>
                    <button onclick="deleteSource('${c.directoryName}')" class="btn" style="background: #dc3545;">删除</button>
                </td>
            </tr>
            `).join('')}
        </table>
    </div>
    
    <script>
        async function updateSource(dirName) {
            await fetch(\`/admin/api/update/\${dirName}\`, { method: 'POST' });
            alert('更新任务已提交');
        }
        
        async function deleteSource(dirName) {
            if (confirm('确定删除此配置？')) {
                await fetch(\`/admin/api/configs/\${dirName}\`, { method: 'DELETE' });
                location.reload();
            }
        }
        
        document.getElementById('addForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);
            
            await fetch('/admin/api/configs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            location.reload();
        });
    </script>
</body>
</html>`;
    
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }

  // API 路由
  if (path === '/admin/api/configs' && request.method === 'POST') {
    try {
      const newConfig = await request.json();
      
      if (!newConfig.directoryName || !newConfig.sourceUrl || !newConfig.extension) {
        return new Response(JSON.stringify({ error: '参数不完整' }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const configs = await getAllConfigs(kv, config);
      
      if (configs.some(c => c.directoryName === newConfig.directoryName)) {
        return new Response(JSON.stringify({ error: '目录名已存在' }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      configs.push({
        ...newConfig,
        created: new Date().toISOString(),
        lastUpdated: null
      });
      
      await saveConfigs(kv, config, configs);
      await addLog(kv, 'info', `添加新配置: ${newConfig.directoryName}`);
      
      return new Response(JSON.stringify({ success: true }));
    } catch (error) {
      return new Response(JSON.stringify({ error: '请求格式错误' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  if (path.match(/^\/admin\/api\/configs\/[^\/]+$/) && request.method === 'DELETE') {
    const dirName = path.split('/').pop();
    const configs = await getAllConfigs(kv, config);
    const filtered = configs.filter(c => c.directoryName !== dirName);
    
    if (filtered.length === configs.length) {
      return new Response(JSON.stringify({ error: '配置不存在' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    await saveConfigs(kv, config, filtered);
    await kv.delete(`${config.KEYS.FILES}${dirName}`);
    await addLog(kv, 'info', `删除配置: ${dirName}`);
    
    return new Response(JSON.stringify({ success: true }));
  }
  
  if (path.match(/^\/admin\/api\/update\/[^\/]+$/) && request.method === 'POST') {
    const dirName = path.split('/').pop();
    const configs = await getAllConfigs(kv, config);
    const fileConfig = configs.find(c => c.directoryName === dirName);
    
    if (!fileConfig) {
      return new Response(JSON.stringify({ error: '配置不存在' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 异步执行下载
    ctx.waitUntil(downloadFile(kv, config, fileConfig));
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: '下载任务已开始' 
    }));
  }

  return new Response('管理页面不存在', { status: 404 });
}
