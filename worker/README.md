# Worker 中转（可选，但强烈建议）

## 为什么需要它

浏览器直接去抓别人服务器上的图，有两道坎：

- **跨域（CORS）**：对方服务器不点头，浏览器就不让你读到图片数据。大部分对象存储桶、图床默认都不点头。
- **防盗链**：对方看到请求是从你的网页发出的，直接返回 403。

Worker 是在 Cloudflare 的服务器上去取图，不带网页来源，这两道坎都能绕过去。
免费额度每天 10 万次请求，搬图完全够用。

不部署也能用这个工具，只是遇到上面两种情况的图会取不到（工具里会明确标出来，不会假装成功）。

## 部署方法（三分钟）

### 方法一：网页上点几下

1. 打开 [dash.cloudflare.com](https://dash.cloudflare.com) → 左边 **Workers & Pages** → **Create** → **Start with Hello World!** → **Deploy**
2. 部署完点 **Edit code**，把本目录 `image-proxy.js` 的内容整个贴进去，覆盖原有代码，点 **Deploy**
3. 回到 Worker 的 **Settings → Variables and Secrets**，加一个变量：
   - `ACCESS_TOKEN` = 你自己随便编一串密码（**建议加上**，不然别人知道地址就能白嫖你的流量）
4. 把 Worker 地址（形如 `https://xxx.workers.dev`）和刚才的口令填进工具的「Worker 中转」里，点「测试连接」

### 方法二：命令行

```bash
npm install -g wrangler
wrangler login
cd worker
wrangler deploy
wrangler secret put ACCESS_TOKEN      # 按提示输入口令
```

## 想用 Cloudflare R2 存图的话

R2 不能从浏览器直传，必须走这个 Worker。额外做两步：

1. **建桶并绑定**：Cloudflare 控制台 → R2 → 创建存储桶 → 回到 Worker 的
   **Settings → Bindings → Add → R2 bucket**，变量名**必须填 `BUCKET`**，选你刚建的桶。
2. **开公开访问**：R2 桶 → Settings → Public access，绑一个自定义域名（或开 r2.dev 公开地址），
   然后在 Worker 的变量里加 `PUBLIC_BASE` = 那个公开地址，例如 `https://img.yourdomain.com`。

用 wrangler 的话，`wrangler.toml` 里已经写好了模板，去掉注释改成你的桶名即可。

配好之后在工具里点「测试连接」，会显示「R2 存储桶已绑定」。

## 接口说明

| 路径 | 方法 | 作用 |
|---|---|---|
| `/ping` | GET | 健康检查，返回有没有绑 R2 |
| `/fetch?url=...` | GET | 服务器端取图，带 CORS 头返回 |
| `/upload?key_name=...` | POST | 上传到 R2，返回公开链接 |
| `/forward` | POST | 转发上传请求到图床 API（用 `X-Target-Url` 头指定目标） |

设了 `ACCESS_TOKEN` 后，所有请求都要带 `?key=你的口令`。

## 安全上的几点

- `/fetch` 和 `/forward` 都挡掉了内网地址（127.x、10.x、192.168.x 等），不会变成内网扫描工具。
- `/forward` 只转发到白名单域名（sm.ms、api.imgbb.com、api.github.com）。
  自建图床要加的话，设环境变量 `ALLOW_HOSTS`，逗号分隔，例如 `img.mysite.com,pic.other.com`。
- 单文件上限 40MB。
- **一定要设 `ACCESS_TOKEN`**。不设的话任何人拿到你的 Worker 地址都能用它当代理。
