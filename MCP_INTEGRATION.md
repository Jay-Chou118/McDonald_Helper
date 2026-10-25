# 麦搭的麦当劳 MCP 集成

麦搭通过麦当劳官方 MCP 读取营养、门店、菜单和本人优惠券，计算真实应付金额，并在用户确认后创建订单。核心业务是：满足用户自行设置的营养、忌口与预算条件，再从已核价候选中选出实付更低的搭配。

## Server 与认证

- 官方服务：`https://mcp.mcd.cn`。
- 官方文档：[M-China/mcd-mcp-server](https://github.com/M-China/mcd-mcp-server)。
- 传输：Streamable HTTP；使用 `@modelcontextprotocol/sdk` 的 `Client` 和 `StreamableHTTPClientTransport`。
- 认证：服务端请求头 `Authorization: Bearer ${MCD_MCP_TOKEN}`，这里的变量仅表示凭证占位符。
- 实现：[server/mcp.mjs](server/mcp.mjs) 的 `createMcd(token)` 为每个凭证作用域创建独立客户端，调用 `client.callTool({ name, arguments })`，解析官方响应并脱敏错误。

当前网页的实际认证流程是：用户在[麦当劳开放平台](https://open.mcd.cn/mcp)登录本人账号并获取 token，在本机网页的密码框中自行粘贴；后端验证成功后将 token 保留在该会话的内存中。网页不从环境变量读取个人 token，也不要求将 token 发送给 LLM。服务重启后需要重新连接。

[mcp-config.example.json](mcp-config.example.json) 是供外部 MCP 宿主参考的脱敏配置，凭证只使用 `${MCD_MCP_TOKEN}` 环境变量占位符。使用时须由支持该语法的宿主或其私密配置机制注入本人凭证；不同宿主的变量语法可能不同，JSON 本身不会展开变量。麦搭网页及本地 Skill 启动器不读取此示例文件，网页连接仍按上述流程完成。

## 实际调用的 Tool

| Tool | 项目用途 | 主要实现 |
|---|---|---|
| `list-nutrition-foods` | 验证连接，取得官方营养数据；映射份量并累计热量、蛋白质、脂肪、碳水和钠 | `server/data.mjs`、`server/planner.mjs` |
| `query-nearby-stores` | 查询到店取餐的收藏门店，或按城市、地址关键词搜索门店 | `server/index.mjs` |
| `delivery-query-addresses` | 查询本人已经保存的配送地址 | `server/index.mjs` |
| `delivery-query-stores` | 按所选配送地址查询可配送餐厅 | `server/index.mjs` |
| `query-meals` | 获取所选门店及渠道当前可售菜单与价格 | `server/data.mjs` |
| `query-meal-detail` | 获取餐品详情、套餐轮次及选项，展开合法组成并匹配营养 | `server/data.mjs`、`server/planner.mjs` |
| `query-store-coupons` | 获取本人在所选门店可用的优惠券及对应优惠餐 | `server/data.mjs` |
| `available-coupons` | 展示当前可领取的麦麦省券 | `server/offers.mjs` |
| `campaign-calendar` | 展示近期活动，活动宣传价格不直接作为订单实付 | `server/offers.mjs` |
| `query-my-coupons` | 分页查询本人券包，展示有效期及渠道提示 | `server/offers.mjs` |
| `auto-bind-coupons` | 用户点击领取后，一次领取当前全部可领麦麦省券 | `server/offers.mjs` |
| `calculate-price` | 优惠餐探价、候选比较、常点复用、结算、同份量单点比较及提交前核价 | `server/data.mjs`、`server/index.mjs`、`server/value.mjs`、`server/savings.mjs` |
| `create-order` | 用户确认餐品、门店、取餐方式与实时金额后创建真实订单，返回官方支付入口 | `server/index.mjs` |
| `query-order` | 用户同步本工具订单状态后，按已确认支付金额统计月消费 | `server/index.mjs`、`server/savings.mjs` |

## 调用流程

1. **连接与选店**：验证本人 token → `list-nutrition-foods`。到店模式调用 `query-nearby-stores`；麦乐送依次调用 `delivery-query-addresses` 和 `delivery-query-stores`。
2. **构建候选**：`query-meals` + `query-store-coupons` → `query-meal-detail` → 将套餐各轮次、可选餐品及优惠餐映射到官方营养记录。优惠餐用 `calculate-price` 确认默认组成的餐品金额。
3. **搭配与比价**：本地引擎筛选营养和忌口达标组合 → 按估价选取最多 24 个候选并兼顾主食与优惠方案 → `calculate-price` → 按官方实付金额筛选预算并排序，最多展示三种不同主食推荐。
4. **预算挑战**：15 / 20 / 25 元或自定金额替换本次预算，沿用当前营养与忌口。展示预算内方案、差额或无解原因；不自动放宽条件。退出挑战恢复日常预算。
5. **优惠刷新**：查询活动和券包不会自动领取。用户点击领取 → `auto-bind-coupons` → 清除菜单、券和报价缓存 → 重新查询、搭配与核价。结果不明时不自动重试领取。
6. **结算与提交**：按实际餐具选择调用 `calculate-price`；在有可比单点组成时额外计算同条件单点金额。用户明确确认 → 再次 `calculate-price` → 金额与取餐方式通过校验后调用 `create-order`。价格变化时要求重新结算；用户自行在官方页面付款。
7. **常点与消费复盘**：收藏只记录搭配，复用时重新匹配最新菜单、营养、优惠和预算。用户同步 `query-order` 后才按已确认支付的本工具订单更新月消费，不将报价或待付款订单计为消费。

## 参数与数据边界

- 门店与渠道传递 `storeCode`、`orderType`、`beType`；麦乐送还需要官方返回的 `beCode`，查询配送门店及提交配送订单时使用用户选择的 `addressId`。
- 核价及下单的 `items` 传递真实 `productCode`、`quantity`；套餐保留完整 `roundList`、`round`、`comboItemList` 及子项编码。优惠餐附带当前账号的 `couponId`、`couponCode`，不靠券面金额推算实付。
- 金额按整数分计算。推荐含接口返回的配送及打包费用、不含餐具；结算按餐具选择重新核价，预算挑战再次核验完整费用。
- 官方营养无法匹配的餐品不进入自动推荐；不把未知营养当成零。关键词排除不能验证完整配料或过敏原。
- 天气来自 Open-Meteo，星期按上海时区计算，均属于本地排序上下文。天气失败时关闭天气排序；天气与星期不会改变官方可售菜单或虚构优惠。
- “最低价”仅指已核价候选，不保证全菜单、全网或跨平台最低；搜索范围见 [README 推荐规则](README.md#推荐规则)。
- 凭证、客户端、缓存及报价按会话隔离。下单前检查报价归属、连接版本、有效期和状态；同一报价不重复创建订单，提交结果不明时要求先在官方 App 核实。

## 业务价值与复现

预算挑战将“有限金额能否吃到符合自设营养条件的一餐”变成可核验的问题；官方核价避免把套餐标价、宣传价或优惠券面值误当成最终实付。常点复用仍会重新核价，月预算只统计确认已支付的本工具订单，让一次推荐可以延续到日常消费复盘。

运行方法见 [README 启动](README.md#启动)；本地 Skill 入口为 [.trae/skills/mai-pick/SKILL.md](.trae/skills/mai-pick/SKILL.md)。可按以下步骤复现查询与核价流程：

1. 启动网页，在浏览器连接本人账号，选择当前可营业门店。
2. 在「我的偏好」设置单餐热量范围、最低蛋白质、最高钠、忌口和预算。
3. 选择「20 元预算挑战」，点击「帮我搭一餐」，查看实际核价数量、营养和预算差额；是否有解取决于当前门店、优惠及约束。
4. 查看优惠与券包；仅在希望领取时点击领券，再重新推荐。
5. 进入结算确认含费用金额。演示查询与比价无需创建订单。

运行 `npm test` 验证协议映射、套餐营养、价格排序、优惠、预算及会话边界，运行 `npm run build` 验证网页构建。HTTP 自动化测试注入模拟 MCP 客户端，不调用真实领券或下单接口。此前已完成的真实连接验证仅涉及查询与价格计算；真实下单及支付不属于自动化测试覆盖范围。
