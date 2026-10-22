不卡壳（NodCue）征文技术配图

06-login-architecture：两个前端、Node.js 服务与 PostgreSQL 的整体架构。
07-pairing-flow：生成配对码、兑换网页会话、查看配对状态、保存与手动刷新。

.mmd 是可编辑的 Mermaid 源文件；.svg 为矢量版本；用于发帖的 PNG 在 ../assets/ 下。
本次用 Mermaid 12.2.0 与 Microsoft Edge 渲染。图中只标出凭证名称，不包含真实密钥或会话值。

源码核对位置（仓库根目录为基准）
• src/pages/index/index.ink：OpenAPI 账号读取、每 2 秒配对查询、登录成功提示、手动刷新。
• src/lib/nod-service.js：设备请求头和 API 路径。
• server/app.js：共享 key 校验、配对兑换、Cookie、网页用户范围、默认词库接口。
• server/security.js：配对摘要、7 天签名会话；签名不是加密。
• server/domain.js：30 秒配对有效期。
• server/store.js：配对记录的事务锁定、过期检查与一次性消费，用户与词库归属。

读图约定
• 眼镜的 accountId 来自宿主；设备接口当前用共享 key 校验接入，再按客户端提交的 accountId 关联用户。
• 当前实现没有额外验证 Rokid 签名的身份令牌，图中不表示服务端已独立验证其账号归属。
• 流程图中眼镜到网页的虚线表示用户手动输入数字，不表示两端直接传输凭证。
• 配对状态轮询与网页兑换可并行发生；图中为便于阅读展示一次成功后的状态查询。
• 登录成功只提示刷新入口。词库更新在用户主动刷新后加载，图中不是自动推送。
• 图内流程按当前仓库实现绘制，本次只更新文章和配图。
