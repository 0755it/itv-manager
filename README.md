# itv-manager
源管理
Cloudflare Workers部署，手动添加源地址，定时下载源，提供本地短地址，规避显示获取源地址，规避梯子问题。

创建workers（helloworld）。
创建一个kv空间，绑定kv空间为IPTV_STORE
创建变量ADMIN_USERNAME和ADMIN_PASSWORD，设置自己的登录用户名和密码，不设置则默认用户名为admin，密码为admin123。
设置自定义域名'itv.自己的域名'，禁用自动分配的域名（据说少被别人扫描）
设置触发时间，实现定时下载直播源内容。
编辑CF的worke.js代码，把上面的worker.js的内容拷贝到其中去，重新部署。
访问'itv.自己的域名/admin'，使用自己的用户名和密码登录，根据页面内容添加自己找到的（人家定时会更新的）直播源，首次添加完成需手动更新1次。
返回主页即看到这个直播源的地址。

2026.02.03
