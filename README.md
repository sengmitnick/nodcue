# NodCue · 不卡壳

面向 Rokid Glasses 的点头发音提示工具，基于 AIUI。

这是“AIUI，人人都可以做自己的小工具”的一个完整示例：用户在网页创建自己的词库，Rokid Glasses 打开后同步默认词库；当前词条显示在视野里，点头即可用原生 TTS 朗读。词条支持中文、英文、日文等任意语言，词库还可以设置可选的演讲倒计时。

“不卡壳”只是从个人痛点出发做小工具的一个例子。产品不内置演示场景，所有词库与词条都由当前用户在网页创建。

## 使用闭环

1. 眼镜读取当前 Rokid 账号；单击镜腿打开操作菜单，选择“网页登录”生成一次性四位配对码。
2. 电脑打开自己部署的网页服务，输入配对码后进入当前用户的词库工作台。
3. 创建词库、录入任意语言词条，可选倒计时，并将一个非空词库设为默认。
4. 眼镜提示登录成功后，从菜单选择“刷新词库”，同步最新默认词库。
5. 点头朗读当前词条，左右摇头或滑动镜腿切换词条；倒计时启用时显示在底部。

配对码有效 30 秒且只能使用一次，服务端只保存其摘要。浏览器登录使用签名、HttpOnly、Secure Cookie。

## 眼镜交互

- 点头：朗读当前词条。页面同时使用 `onHeadGesture` 与 30Hz `Gyroscope` 检测，兼容尚未投递页面级手势事件的真机宿主；防抖会阻止两条路径重复朗读。
- 左右摇头：切换到下一词。页面级手势事件与 30Hz `Gyroscope` 后备共用 2 秒防抖，一次摇头只切换一次；菜单打开或正在朗读时忽略摇头。
- 镜腿前后滑动或上下方向键：菜单关闭时切换词条，后滑/上为上一词、前滑/下为下一词；真机会在一次滑动中先上报水平中间码、再上报最终上下键，因此应用只消费最终的 `ArrowUp` / `ArrowDown`，避免一次滑动切换两次。
- 镜腿点击或回车：打开操作菜单；再次单击执行当前项。
- 菜单顺序：朗读词汇、下个词汇、刷新词库、网页登录、退出。
- 菜单打开时，镜腿前后滑动或上下方向键只在菜单中循环选择；返回键关闭菜单。
- 真机菜单按键只把 `Enter` 视为确认；`GlobalHook` 和缺少按键码的事件必须忽略，避免它们抢在方向键之前打开或执行菜单。
- 网页兑换配对码后，眼镜显示登录成功；词库不会被静默覆盖，需要从菜单主动刷新。
- 朗读优先使用 Web Speech，宿主未提供该接口时回退到 `wx.speech.playTTS`。
- 可选倒计时：在页面底部显示 `mm:ss`，归零后仍可继续朗读。

## 目录边界

- `src/`：AIX/Craft 唯一导入目录，只包含眼镜运行时代码。
- `config/`：可提交的眼镜配置模板，不进入 AIX；真实配置生成在 `src/lib/nod-service-config.js`，由 Git 忽略。
- `server/`：Node 后端、PostgreSQL 迁移、配对登录、词库 API 和静态网页，不进入 AIX。
- `tests/`：领域、API、网页、眼镜客户端、交互、数据与部署契约测试。
- `deliverables/store-listing/`：展示图片、实机视频和上架文案；本地构建的 AIX 输出到 `deliverables/`，不提交。

## 本地运行

后端、本地开发、自动化测试和生产环境统一使用 PostgreSQL，不存在第二套文件存储逻辑。要求 Node.js 20+、PostgreSQL 15+，以及用于上架素材二进制校验的 FFmpeg/FFprobe。

```bash
npm install
cp -n config/nod-service-config.example.js src/lib/nod-service-config.js
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/nod_pronouncer'
npm run db:migrate
npm test
npm start
```

本地网页地址为 `http://127.0.0.1:3200`。`npm start` 必须提供 `DATABASE_URL`；迁移可重复执行，已应用的 SQL 会记录在 `nod_migrations`。

## 眼镜本地配置与服务器配对

`src/lib/nod-service-config.js` 是当前开发者的本地配置模块，和 `.env` 一样不提交到 Git。眼镜运行时不读取服务端的 Node.js 环境变量，因此要在预览、Craft 导入或打包前先创建此文件：

```bash
cp -n config/nod-service-config.example.js src/lib/nod-service-config.js
```

`-n` 会保留已有配置。首次复制的模板内容如下，默认只用于电脑本地预览；服务端未设置 `NOD_CLIENT_KEY` 且未开启生产模式时使用相同的开发默认值：

```javascript
export const NOD_SERVICE_CONFIG = {
  baseURL: 'http://127.0.0.1:3200',
  clientKey: 'nod-pronouncer-local-client',
};
```

真机部署时，编辑生成的本地文件，并与自己的服务器按下表配对：

| 配置项 | 眼镜本地文件 | 服务端 |
| --- | --- | --- |
| 服务地址 | `baseURL` 填自己的 HTTPS 服务地址，如 `https://your-nod-server.example.com`，不带 `/api` | 此地址提供网页及 `/api/...` 接口 |
| 客户端凭据 | `clientKey` 填本次部署生成的值 | `NOD_CLIENT_KEY` 必须填写完全相同的值 |
| 会话签名密钥 | 不写入眼镜文件 | `NOD_SESSION_SECRET` 单独生成，只留在服务端 |
| 数据库连接 | 不写入眼镜文件 | `DATABASE_URL` 只留在服务端 |

生产客户端凭据和会话签名密钥各用一次 `openssl rand -hex 32` 生成，使用两个不同的随机值；不要使用模板里的开发默认值。把客户端值写入本地文件的 `clientKey` 和 Dokploy/服务进程的 `NOD_CLIENT_KEY`，把另一个值仅写入服务端 `NOD_SESSION_SECRET`。`.env.production.example` 只有占位符，复制后需要自行填写；直接运行 `npm start` 不会自动加载 `.env.production`，需由启动环境提供变量，或交给下方的 Docker Compose 加载。

电脑上的 `127.0.0.1` 只用于本地预览。真机的 `baseURL` 必须是眼镜能够访问的服务器地址。配置完成后运行 `npm run pack`，将新 AIX 安装到眼镜；之后修改客户端 key 时，也要同步更新服务端环境和眼镜包。key 不一致时，设备接口返回 `401 unauthorized_client`，表现为无法同步词库或生成配对码。

真实配置模块会进入 AIX，因此生成的 AIX 也属于含客户端凭据的本地产物，和真实配置文件一起保持 Git 忽略。

当前设备 API 在共享客户端 key 校验通过后，使用请求中的 `accountId` 查找用户。持有 key 且知道账号 ID 的调用者可以获取对应词库和申请配对码；key 也可以从已分发的 AIX 提取。因此当前方案应使用自己的自托管服务；面向不受信任用户提供多用户公共服务前，需要增加服务端可验证的用户或设备身份校验。

## 预览、打包与真机更新

```bash
npm run preview
npm run pack
npm run inspect
```

`npm run pack` 以 `src/` 为根生成 `dist/nod-pronouncer.aix`，并复制到 `deliverables/nod-pronouncer.aix`。后端、网页、测试和参考材料都不会进入 AIX。

所有 `*.aix` 均为本地构建产物，由 Git 忽略。从仓库新检出后，先按上一节生成配置，再自行打包。配置模板位于打包根 `src/` 外，不会进入 AIX。

眼镜页面使用固定的 480×352 全屏画布。跨状态元素必须分别使用显式且互斥的 `ink:if` 条件控制是否渲染，例如 `mode === 'ready'` 与 `mode !== 'ready'`；不要依赖 `ink:else` 的节点邻接关系，也不要保留 `*Class: '... hidden'`、透明度或 `.hidden { display: none; }` 这类可见性状态，否则 Craft 预览正常时，真机仍可能把计数器、提示或菜单节点叠加显示。

阅读页采用无框的下方视野 HUD：上方视野保持留白，词条或配对信息锚定在底部操作条上方，词条位置与可选倒计时收进底栏。配对有效期只用一条细进度线表达，不使用卡片、圆角框或覆盖整块视野的绿色边线。

在 AIUI Studio/Craft 中导入 `src/` 前，先生成本地配置。使用 ADB 更新已有调试包时，先填写自己的设备序列号和包路径；下面的路径需替换为自己设备上的应用包路径：

```bash
export DEVICE_SERIAL='replace-with-your-device-serial'
export AIX_DEVICE_PATH='/sdcard/jsai/package/replace-with-your-package-id.aix'
adb -s "$DEVICE_SERIAL" push dist/nod-pronouncer.aix "$AIX_DEVICE_PATH"
adb -s "$DEVICE_SERIAL" shell am startservice \
  -n com.rokid.os.sprite.assistserver/com.rokid.os.sprite.jsai.JsaiService \
  -a com.rokid.os.sprite.jsai.OPEN_PAGE \
  --es open_params "$AIX_DEVICE_PATH"
```

发送按键可验证切词与菜单，朗读仍由点头手势触发：

```bash
adb -s "$DEVICE_SERIAL" shell input keyevent KEYCODE_DPAD_DOWN
adb -s "$DEVICE_SERIAL" shell input keyevent KEYCODE_ENTER
```

## Docker、ACR 与 Dokploy

生产镜像使用 Node 22 Alpine，以非 root 用户运行。先验证本地构建和生产 Compose：

```bash
docker build -t nod-pronouncer:test .
cp .env.production.example .env.production
docker compose --env-file .env.production -f compose.production.yml config --quiet
```

推送 `main` 后，GitHub Actions 工作流 `.github/workflows/publish-nod-pronouncer.yml` 会构建 `linux/amd64` 镜像并发布到：

```text
qinglion-registry.cn-hangzhou.cr.aliyuncs.com/sengclaw/nod
```

仓库需配置 `ACR_USERNAME` 与 `ACR_PASSWORD` 两个 GitHub Actions Secret。工作流发布 `main` 和 `sha-*` 标签；生产部署使用不可变的 `sha-*` 标签，回滚时只需把 `NOD_SERVICE_IMAGE` 改回上一个健康摘要对应的标签。

Dokploy 使用 `compose.production.yml` 的 Raw Compose：

- `migrate` 先执行 `npm run db:migrate`，成功后才启动 `web`。
- `web` 在容器端口 `3200` 提供网页与 API，通过 `/healthz` 检查 PostgreSQL 连通性。
- Compose 不自建数据库，直接通过 `DATABASE_URL` 使用 Dokploy 中的 PostgreSQL 服务。
- `web` 绑定自己的服务域名、路径 `/`、容器端口 `3200` 并启用 HTTPS；该域名需与眼镜配置的 `baseURL` 对应。
- 所有容器加入现有外部网络 `dokploy-network`，无需公开数据库或应用宿主机端口。

生产环境变量：

- `NOD_SERVICE_IMAGE`：ACR 的不可变 `sha-*` 镜像标签。
- `DATABASE_URL`：Dokploy PostgreSQL 内部连接 URL。
- `NOD_CLIENT_KEY`：眼镜客户端共享凭据，必须与本地生成的 `src/lib/nod-service-config.js` 中的 `clientKey` 一致，再打包进 AIX。
- `NOD_SESSION_SECRET`：只保留在服务端，用于配对摘要与网页会话签名，必须与客户端凭据不同。
- `NOD_SERVER_PORT`：默认 `3200`。

数据库密码、会话签名密钥只写入 Dokploy 环境，ACR 登录凭据使用 GitHub Secret；眼镜客户端共享凭据另写入被 Git 忽略的本地配置并随 AIX 分发。真实配置不应提交或写入日志。服务上线后，把下方示例域名替换为自己的地址验收：

```bash
curl -fsS https://your-nod-server.example.com/healthz
curl -fsSI https://your-nod-server.example.com/
```

## 演示素材

展示素材位于 `deliverables/store-listing/`，包含实机画面与网页工作台截图。
