# 项目协作与交付前端重构决策

> Status: Decision（分阶段实施）
> Date: 2026-08-16
> Active spec: `specs/frontend-architecture-refactor/`

> 2026-08-31 更新：Project 默认常驻协作流及“Project 输入框”决策已被
> `docs/product/ux/2026-08-31-project-workitem-hierarchy.md` 替代。Project 现在是长期聚合容器，
> 新讨论与执行默认归属于独立工作项；本文件其余交付事实与渐进展示原则继续有效。

## 一、用户问题

当前首页把“项目、会话、群聊、任务、团队、评估、调试”同时放到第一层。用户进入页面后首先看到的是
Agent 群聊和运行状态，而不是自己创建的交付、验收进度和真正需要处理的异常。右侧又把同一批任务的看板、
地图、待办和风险拆成四个一级页签，导致用户需要先理解产品实现，才能判断工作是否完成。

代码中的对象命名也放大了这个问题：`Conversation` 在页面上被称为“项目”，`projectPath` 才是真正的项目目录，
自主交付又是挂在 Conversation 下的第三个对象。重构必须先统一用户心智，不能只换颜色和布局。

## 二、目标用户心智

用户管理的对象固定为六类：

1. **项目**：一个真实工作目录及其长期上下文。
2. **协作流**：人和 Agent 围绕项目持续沟通、触发工作并看到关键事实。
3. **工作项**：具有目标、验收条件、负责人和依赖的任务。
4. **产物**：代码、文档、测试、构建、链接和发布等可引用结果。
5. **评审 / 发布**：对明确产物版本的判断，以及可选的对外交付批次。
6. **需要处理**：只有必须由用户提供知识、选择或新授权时才出现的异常。

Agent、团队和能力是完成工作的资源，不是首页的主对象。Invocation、Session、Runtime、Receipt、Lease、
路由和传输只属于“活动记录”或“调试”，不进入主任务体验。

不再要求用户创建一个 Delivery Run 才能开始工作。交付是 WorkItem、Artifact、Review/Gate 与可选 Release
持续形成的事实集合；目标和验收条件直接属于工作项或 Release。历史 Delivery Run 只可作为内部编排投影，
不能继续决定新页面的信息架构。

对象关系补充：Review 是一等对象，不是“任务进入评审状态”的 UI 包装。一个工作项可以关联多个 Review；每个 Review 明确指向仓库分支或产物版本，独立记录开放、要求修改、通过和关闭。协作空间对项目、工作项、Review 和产物的归属由消息中的对象引用自动投影，不要求用户再手工选择一遍。

## 三、目标信息架构

```text
全局工作区
├── 项目导航
│   ├── 项目
│   └── 最近工作 / 需要处理
├── 项目协作主视图
│   ├── Telegram 式连续协作流
│   ├── 消息与 Command Fact 卡片
│   └── 常驻输入 / 上下文动作
├── 对象详情
│   ├── 工作项 / 产物 / 评审 / 发布
│   └── Agent / 调试（按需）
└── 全局设置
    ├── 模型账号
    ├── Agents（身份 / 指令 / Skills / 运行环境 / 模型）
    ├── 团队
    └── 基础资源（模型账号 / 运行环境 / Skills）
```

### 3.1 项目导航

- 侧栏展示可独立存在的 Project，不再把 Conversation 或 Delivery Run 命名为项目。
- 全局只有一个醒目的创建动作“添加项目”；具体工作在项目协作流中自然创建或由 Agent 提议。
- Project 展示当前工作、待评审和需要处理数量；Agent 在线状态不占侧栏主信息。
- 搜索匹配项目、工作项、产物与协作内容。

### 3.2 项目协作主视图

- 首屏固定回答四个问题：团队正在做什么、产生了什么、哪些结果待评审、是否需要我处理。
- 不使用一个 Delivery Run 阶段覆盖所有工作；每个 WorkItem、Artifact、Gate 和 Release 展示自己的事实状态。
- Project 输入框使用“发消息给团队”语义；底层仍提交 Human Command，但界面不向用户暴露命令、路由或自动接手机制，也不把普通聊天文本当任务事实。
- 协作流使用结构化时间线展示消息、任务变更、产物、评审和交接；普通运行观察折叠。
- Agent 当前接纳、派发与交接摘要是 Project 级运行状态，固定放在 Project 视图导航下方、主内容上方；它不进入消息时间线或输入器区域，完整记录从状态栏向下浮层展开。
- 同一 Invocation 中，真实工具调用始终以 Trace 卡片可见；Trace 收起时仍展示最近的工具名称和目标，展开后才显示完整输入输出。工具前后的身份介绍、计划播报和过程复述默认折叠。
- 时间线以“一次 Agent 回复”而不是“连续同一个 Agent”作为展示实体。同一 Invocation 的流式正文、工具调用、诊断和最终结论只更新一个回复，不因并行 Agent 插话而裂成多个气泡。
- 不同 Invocation 不得因为发送者相同而合并或整组折叠。Agent 回复先显示核心结论；超过一个阅读屏的长正文默认收起，但证据卡、任务卡、工具调用和异常必须保持可见，用户可在原位置展开完整原文。
- Task 通知、自动唤醒和控制面变化使用居中的活动提示，不伪装成 Agent 发言；Agent 间交接只在接手回复上显示简短来源，不展示内部 packet 或原始路由文案。
- Project 内“创建工作”只收集 Category、标题和可选说明，不要求先指定 Agent；工作创建后可在协作中认领或委派。
- “发起评审”使用独立表单收集仓库、Base、Compare、标题和可选说明。Project 已确定时不重复选择 Project，分支和仓库由当前 Project 上下文提供。
- 创建成功后立即打开对应对象，并在协作流产生可引用的事实卡；失败保留表单和用户输入，展示可执行的修复建议。

### 3.4 Agents 与 Agent teams

- Agents 页面先展示当前 Agent 对象，再展示 Agent teams；Team 的目的只有一个：把一组 Agent 快速部署到协作空间。
- 新 Agent 的基础步骤只问名称和日常职责；Harness、模型、访问对象、并行度、实例名池和环境变量放入 Customize/Advanced。
- Harness 选择展示已安装、需登录、未安装和自定义状态；不可用项仍可查看安装指引，但不能保存为可运行 Agent。
- Team 支持创建、导入、复制、编辑、分享和“部署到协作空间”。部署前展示成员、目标空间与不可运行原因，完成后逐成员报告成功/失败。
- Agent profile 从任何入口打开都保持同一组 Activity / Info / Runtime / Channels / Memories；运行信息只显示服务端真实观测值，不用配置值伪装在线。

### 3.3 工作与调试

- 右侧一级入口只保留“任务”和“调试”。
- “需要关注”吸收原待办和风险；看板、列表、关系图只是同一工作项集合的视图模式。
- 调试默认不展开，内部实现词只允许出现在这里。
- 评估继续作为项目内建工作模式，但不与日常交付状态混排。

## 四、视觉与交互方向

- 使用项目现有品牌视觉系统重新设计，不复用外部产品的名称、Logo、吉祥物、角色形象、文案、颜色 token、
  尺寸 token、CSS 结构或组件命名。
- 层级主要由背景、留白和排版建立，减少重复描边、胶囊和同时竞争的卡片。
- 每个页面只保留一个主操作；次级动作就近放入对象菜单或详情。
- 状态颜色只表达状态，不装饰普通容器。
- 切换项目或交付时，未发送草稿不得被后台水合清除，也不得自动投递到新的交付。

## 五、Clean-room 研究边界

本轮对同类开源产品的真实实现、架构资料与许可证做了隔离审计，只吸收以下抽象原则：

- 长期挂载的工作区 Shell，避免切换对象时反复卸载主要交互区；
- 全局导航与对象内导航分层；
- 项目目录与工作会话/交付分开建模；
- 传输、身份、消息投影和派发拥有不同责任边界；
- 用架构 owner 文档约束功能归属。
- 用稳定 Invocation 身份承载单次回复，把 thinking、工具 Trace、诊断和回执作为回复的附属内容；系统提示与 Agent 气泡使用不同渲染面。

明确不采用：

- Chat-first 的产品主对象；
- 猫形象、角色资产、名称、文案和视觉语言；
- 外部源码、组件结构、CSS/token、目录命名和大型 `chatStore` Implementation；
- 为追求外观相似而引入 Next.js 14、Redis 或另一套事实源。

仓库中的实现必须独立完成，产品、源码、测试、文档和交付物均不出现来源品牌痕迹。若未来直接复制任何受开源许可
覆盖的实质代码，必须单独完成许可证审查并依法保留声明；本规格不授权这种复制。

## 六、迁移原则

1. 先统一页面对象语言，再调整布局。
2. 先建立只读交付投影，再替换组件的散乱 selector。
3. Human Command 与展示事件分离；自动展示消费者不得产生执行命令。
4. 新 Module 替换旧责任后立即删除旧入口，不保留无退出条件的兼容 UI。
5. 每阶段都能独立回归，不能用一次大爆炸改写同时改变产品对象、运行协议和持久化 schema。

## 七、成功标准

- 用户不理解 Agent 运行实现，也能在首屏判断交付是否正常、完成到哪里、是否需要自己处理。
- 侧栏明确区分项目和交付，创建动作只有一个。
- 右侧一级入口从五个收敛为任务与调试两个；任务的三种表现是视图模式而非独立领域。
- 主视图不出现 `runtime`、`routing`、`session`、`receipt`、`lease`、`providerHints` 等内部词。
- 用户发送要求、切换交付、查看任务与验收证据的关键流程通过浏览器端到端验证。

## 八、第一阶段验证记录（2026-08-16）

- 真实 Next.js 16.2.4 开发服务在独立 worktree 的 `http://localhost:3101` 启动并完成浏览器检查。
- 空态首屏只有一个“新建交付”主操作，侧栏显示“项目与交付”，中心显示交付摘要与次级团队活动。
- 工作面板可展开，辅助技术树确认一级 tab 只有“任务”和“调试”；“需要关注”和“关系图”均位于任务 tab 内。
- 输入框辅助名称与占位文案均为“发消息给团队”，不再使用“作战指挥室/新建项目/新建任务”或内部命令协议作为主流程语言。
- 最终辅助技术树计数确认全页“新建交付”按钮为 1；未选交付时输入不可提交，不会隐式创建交付或把要求发往列表首项。
- 输入提示不再要求用户理解 `@Agent`；服务端按当前交付 Team Runtime 选择可用接手人，无接手人时页面显示明确错误。
- 本记录只证明第一阶段 IA 与空态；创建真实自主交付、验收证据详情和多项目切换仍需自动化浏览器 E2E。

## 九、交付阶段展示口径（2026-08-17）

- 顶部阶段、运行摘要和右侧任务视图必须表达同一个业务进度，不允许出现“正在规划”与“评审中”并存。
- DeliveryRun 的持久阶段仍由服务端 owner 持有；当早期阶段投影尚未推进，而 Task Authority 已给出更晚的执行或评审事实时，`DeliveryWorkspaceProjection` 仅在展示层校正阶段。
- `in_review` 是团队仍在处理的当前工作，必须计入“当前工作”并展示任务标题，不得显示“等待下一项工作开始”。
- 真实页面已验证：原“规划中 / 正在规划 / 0/1 / 等待下一项工作开始”统一更新为“评审中 / 正在评审 / 1/1 / 当前评审任务”。

## 十、Agent 回复时间线口径（2026-08-17）

- 删除“连续同一个 Agent 的 N 次回复”分组。真实历史中的并行 Mario/Peach 事件改按 Invocation 稳定聚合，同一调用只占一个回复位置。
- 同一 Invocation 的工具事件合并为一个 Trace 面板；已完成面板默认收起但标题、完成状态和事件数量始终可见，运行中面板保持展开。
- 中间过程说明默认折叠，最终结论直接显示；同一工作项引用在一次回复中去重，避免每个流式段重复出现同一任务胶囊。
- Task 状态、内容同步和自动唤醒改为居中活动提示，原始通知仅在展开后显示；A2A 接手只显示“接手自某成员”，不暴露原始路由表达。
- 真实页面完全水合后显示 15 个 Invocation 回复、15 个聚合 Trace 和 27 个紧凑活动提示；页面不再出现“某 Agent N 次回复”的历史折叠入口，已完成 Trace 均保持收起。

## 十一、交付、验收与任务进度口径（2026-08-19）

- “交付已完成”来自终态 DeliveryRun；“验收通过”来自该终态冻结的 DeliveryBundle 验收结果；“任务完成”来自 Task Authority。三者不得复用一个无标签的分数。
- 侧栏任务比例必须显示“任务”标签，交付摘要同时独立展示“验收”和“任务”。用户不需要根据 `1/2` 猜它代表任务还是验收。
- 已完成 DeliveryRun 与 Task 明细冲突时，交付阶段和验收结果保持终态，不被 Task 投影降级；任务位置保留真实完成比例、追加“需核对”。具备冻结评审证据的历史回退由服务端自动修复，未关联或不可自动修复的工作项也不会被误报为“正在校准”。
- 校准只恢复已有评审通过证据支持的任务，不把“交付已完成”推导成“所有任务一律完成”，避免隐藏取消项、可选项或真实缺口。

## 十二、验收证据包（2026-08-20）

- 验收数字不是终点。用户可以直接展开“验收证据”，逐条查看验收标准、通过/未通过/待验证结论和对应证据，不必从 Agent 对话中寻找证明。
- 只有冻结 `DeliveryBundle` 中的正式验收结果进入证据包和验收计数。Agent 在聊天中说“已测试”“已验收”只是工作汇报，不能替代正式回执。
- 证据包同时说明验证方式、验证人、所用工具、报告、规格、代码版本和完成时间；这些信息默认收在渐进展开区域，避免压过交付目标和当前工作。
- 非视觉工作允许使用测试、构建、评审或报告作为证据，不强迫上传截图；视觉改动仍应由正式验收流程提供浏览器或 Playwright 证据。
- 当前阶段保留既有字符串证据引用并原样可查。后续若引入结构化证据登记表，来源、权威级别、内容摘要和新鲜度必须由服务端验证，前端不得根据引用文案自行推断。

## 十三、活动历史与首屏性能（2026-08-20）

- 打开交付时优先呈现最新进展、当前工作和输入区，不让全部历史活动、设置、评估或调试工具阻塞首屏。
- 活动区首次只渲染最近 120 个聚合项；存在更早内容时在时间线上方提供“显示更早活动”，每次增加 120 项。该机制只限制浏览器同时渲染的内容，不删除服务端历史。
- 初始工作区快照按交付携带最近 200 条原始消息。当前交付进入可交互状态后先在后台对账最新持久化窗口；用户继续查看时按游标加载更早页面，直到完整历史可访问，保证实时使用优先且历史最终一致。
- 设置、任务详情、成员管理、创建弹窗、评估、调试和关系图均为次级意图；用户没有打开时，不应下载对应业务代码或请求对应数据。

## 十四、Web / 桌面统一工作台壳层（2026-08-23）

本产品与 Buzz 的共同点不是“都有聊天和项目”，而是都要让多个工作空间中的人和 Agent 围绕真实工作持续协作。Buzz 的定位是“relay 即 workspace”：Community 是租户边界，Project 聚合长期代码上下文，Task / Review / Commit / Channel / Workflow 共同形成从工作请求到发布结果的交付链。Buzz 没有用一个万能业务实体替代这些对象；它统一的是事件包络、身份、作用域、因果、幂等、审计和搜索，再由各领域建立清晰的读模型。

我们的定位更窄也更深：它不是通用团队通信工具，而是面向多个 Project 的 Agent 交付系统。因此不能把 Buzz 的 CommunityRail 机械映射成 Project，也不能把 Delivery 当成聊天会话。对应关系固定为：

- Workspace：当前部署的协作与身份边界；现阶段为单工作区，不为只有一个实例预留空轨道；
- Project：真实目录及长期产品/代码上下文，负责组织 Delivery，不拥有一次交付的完成语义；
- Delivery：一次带目标、范围、验收标准和授权的交付承诺，聚合 Task、Evidence、Activity 与 Agent 协作；
- Task / Evidence / Activity：Delivery 的工作、验收和历史投影，不与 Delivery 竞争主对象身份；
- Agent：具有稳定身份、能力和运行状态的参与者，通过选中对象的上下文工作，不是页面中心的聊天机器人。

统一壳层采用以下信息架构：

```text
窗口级 Chrome
└── 工作区侧栏
    ├── 交付总览（跨 Project 的交付组合）
    └── Projects（命名项目，可展开）
        └── Deliveries（项目下的交付）
            └── 交付详情（Overview / Activity / Evaluation）
                └── 按需上下文面板（Tasks / Debug）
```

- Web 与桌面使用同一个 Next.js Renderer 和同一棵组件树；桌面 Host 只提供窗口拖拽、生命周期和本地服务能力，不维护第二套页面。
- 顶部不再承担品牌落地页职责，只保留窗口级身份、唯一主创建动作和全局设置；桌面可在同一元素上启用拖拽区域。
- 侧栏同时提供一个跨项目的“交付总览”入口，以及命名 Project 列表；Project 展开后才显示其 Delivery。这借鉴 Buzz “Projects 一级入口 + Sidebar Projects section”的组织原则，而不是借用 CommunityRail。
- 交付总览是桌面工作台而不是项目卡片墙：顶部给出 Project、可继续 Delivery（进行中 + 已暂停）、任务完成与开放阻塞的组合指标；“继续工作”按最近更新时间直接回到这些 Delivery；命名 Project 区域使用同一口径展示长期目录上下文、整体进度及其 Delivery。开放阻塞与详情中的“需要关注”必须分开命名，前者包含所有未解决阻塞，后者只接受人工 blocker 与 `waiting_human` 权威升级。整个页面只消费跨项目投影，不创建第二套 Project 或 Delivery 事实。
- 选择 Delivery 后进入稳定的交付详情；Agent 请求显式绑定 Project path 与 Delivery identity，Task 只由用户明确引用进入上下文。当前视图属于页面状态，在 Command 契约正式扩展前不得宣称它已进入 Agent 上下文；活动输入不得脱离当前 Delivery 隐式执行。
- 没有交付时展示单一空态和唯一“新建交付”动作；空态解释 Project、Delivery 与 Agent 协作三层关系，但不伪造统计、活动或样例数据，也不挂载团队成员条、空活动时间线、禁用输入框或工作检查器。
- 交付详情仍以阶段、验收、当前工作和需要处理为主；团队活动在已选交付内持续挂载，任务与调试保持按需展开。
- 侧栏、总览、详情和上下文面板使用不同的表面层级，但不复制 Buzz 的品牌、图标、文案、颜色 token、CSS 或组件实现。

桌面体验不是额外主题。相同宽度下 Web 和桌面必须拥有相同的信息架构、选中状态、空态和关键交互；平台差异只允许出现在窗口控制、文件选择、系统通知和生命周期等 Host 能力边界。

## 十五、Delivery 内的连续协作交互（2026-08-23）

本产品采用 Telegram / Buzz 一类通信产品的交互稳定性，但不采用 Chat-first 的业务层级。选择 Delivery 后固定提供三个同级工作面：

- **概览**：阶段、验收、当前工作、需要处理与自主交付状态；
- **活动**：人和 Agent 围绕当前 Delivery 的连续时间线及常驻要求输入；
- **评估**：当前 Project 内的质量评估与改进闭环。

活动面遵守以下交互契约：

- 时间线和输入区在同一 Delivery 内保持稳定，切换概览/活动不改变消息事实或草稿归属；
- 草稿按 Delivery identity 隔离并持久保存在 Renderer 本地，切换 Delivery 时恢复各自草稿，不使用“草稿属于先前项目”的阻塞提示迫使用户来回切换；
- 用户上翻阅读历史时，新消息不得抢走滚动位置；页面提供明确的“回到最新”入口和新增数量；用户自己发送成功后回到底部；
- “引用回复”在输入区上方显示目标作者与摘要，可取消；在正式 reply relation 进入 Command 契约前，它以可见引用文本提交，不伪装成已有线程模型；
- 消息操作在鼠标悬停、键盘聚焦和触屏操作下都可发现；系统活动继续使用居中提示，不伪装成人或 Agent 消息；
- Agent 工作/输入状态靠近输入区表达，不把 Runtime、Session 或 Lane 等内部概念暴露给用户。

明确不采用：把 Project/Delivery 重新退化为频道、把每个 Task 建成聊天线程、用未持久化 UI 未读数冒充服务端事实、复制外部产品的布局尺寸或视觉资产。

## 十六、Project 创建边界与 Agent 运行设置（2026-08-23）

外部参考实现的真实创建层级是“创建长期 Project，再在 Project 中创建 Task / Review 等工作项”。本产品继续保留交付，因为目标、验收标准、授权范围和冻结证据需要一个有界对象；但取消“必须先创建交付才能拥有 Project”的倒置流程。

- 全局主动作是“添加项目”，只询问名称和目录；目录检查与长期上下文初始化由系统完成。
- 交付只在具体 Project 内创建，创建时继承目录，用户只需说明目标、验收和必要授权。
- Project 即使没有交付也必须出现在工作区；空 Project 的主动作是“开始一项工作”。
- “新建交付”不再占据全局 Chrome，也不在弹窗中重复询问已经由 Project 决定的目录。

设置以 Agent 为一等对象，不以“账号、Runtime、角色、Skill”四套分散配置要求用户自己组装执行身份。Agent 卡片是主要入口；打开后统一编辑名称/头像、完整工作指令、Skills、ACP 运行环境、模型账号/模型、权限和执行偏好。Runtime Catalog、账号与 Skill Library 是编辑器选择资源；不存在独立角色素材库。Team 只定义真实 Agent 的组合、协作关系和工作流。主界面使用“运行环境、模型账号、可用、执行中”等用户语言，ACP adapter、launcher、session 只作为次级诊断信息。

## 十七、命令驱动交付修订（2026-08-23，当前有效）

本节替代本文中“Delivery 是必须创建的顶层承诺”“Project 下必须先选择 Delivery 才能协作”“DeliveryRun
终态决定交付完成”等旧决策。重构不保留这些历史页面兼容。

- 交付事实只由统一 CommandService 改变；结构化 MCP 是 Agent 主路径，CLI 是通用接口与逃生仓，Web/Desktop 是人类命令 Adapter。
- Agent 文本、思考、工具 Trace、进度和 `runtime.completed` 是活动观察，不是结果。主时间线在视觉上明确区分轻量活动与 CommandReceipt 产生的事实卡片。
- 项目是稳定协作空间，默认显示连续消息与事实流。用户可以直接提出目标；系统通过 Human Command 创建 WorkItem 或让 Agent 提交结构化任务方案，不再弹出“创建交付”作为前置步骤。
- WorkItem 详情承载目标、验收条件、负责人和依赖；Artifact 详情承载结果与证据；Review/Gate 详情承载独立判断；Release 仅在需要形成对外交付批次时创建。
- “已完成”只能从当前工作权威、产物版本、质量门和外部动作回执计算。Agent 的结论文本始终只能作为说明。
- Telegram 式交互是稳定协作面，不是把业务对象退化成频道：事实卡可以在消息流中出现，但仍可打开正式对象详情并由统一投影对账。

## 十八、真实 Buzz 页面复核后的界面推翻（2026-08-23，当前有效）

本节替代本文中“Project 默认打开协作流”“Project 固定协作 / 工作 / 评估三个页签”“总览以统计卡和 Project 卡片为主体”的决定。2026-08-23 已运行 Buzz Desktop E2E 构建并真实检查 `/agents`、`/projects`、Project 列表、创建菜单、Project 详情与 Agent 创建表单；此前只从代码结构推断出的三页签工作台仍继承了本产品旧页面骨架，不能继续增量修补。

Buzz 值得学习的不是某个卡片样式，而是四个交互契约：

1. **全局对象空间稳定。** Inbox、Agents、Channels/Projects 是持久一级入口；Project 不是左侧树中的 Conversation 容器。
2. **总览是同一事实集的多个镜头。** Activity / Projects / Repositories / Tasks / Reviews / Channels 切换统一对象投影，Activity 是默认监督面，而不是四块统计数字。
3. **上下文与主内容分离。** 主区域负责列表、时间线、文件或工作项；右侧 Context Rail 负责当前范围、创建入口、计数、成员、目录/仓库动作。Agent chat 是按需侧面板，不是所有 Project 的硬编码默认页。
4. **Agent 是定义与运行实例的统一入口。** Agent Persona/Definition 可复用；Managed Agent Instance 持有身份、位置、会话和真实运行状态。列表把两者组合成一个可理解的 Agent 卡片；点击进入稳定 Profile/Activity/Configuration/Runtime，而不是在 Settings 中直接展开一排 Runtime 下拉框。

据此，本产品新的页面骨架为：

```text
Desktop/Web App Shell
├── 全局侧栏
│   ├── 工作动态
│   ├── Agents
│   └── Projects
├── 主内容
│   ├── Workspace Activity（跨 Project 的事实流）
│   ├── Projects / WorkItems / Reviews / Artifacts 镜头
│   ├── Project Object Workspace
│   └── Agent Directory / Agent Profile
└── Context Rail / 可选 Agent Conversation Panel
```

- Workspace 默认是跨 Project Activity：工作创建、分派、提交、评审、阻塞、通过和正式产物按时间组织；普通运行观察降噪并原位更新。
- 顶部镜头切换为 `动态 / 项目 / 工作 / 评审 / 产物`。这些不是五套页面事实，而是同一 Event/Command Projection 的过滤与呈现。
- 右侧 Context Rail 在 Workspace 级展示创建菜单与对象计数；在 Project 级展示目录、Agent、开放工作、评审和产物；在 Agent 级展示身份与真实运行摘要。
- 创建菜单直接提供 `项目 / 工作 / 评审`，不出现 Delivery。创建工作时若当前 Project 已确定，不重复询问 Project。
- Project 详情的主标签按真实对象组织：`概览 / 工作 / 评审 / 产物 / 动态`。是否提供文件、提交和终端由本地目录/仓库能力决定，不为无仓库 Project 渲染空实现。
- 协作输入通过“与 Agent 协作”按钮打开右侧 Conversation Panel；对话与选中 Project/Object 绑定。常驻聊天只存在于用户明确打开的面板，不再挤占 Project 默认主内容。
- Agent Directory 首项是“新建 Agent”，其余是 Definition 与 Instance 合并卡片。卡片主点击打开 Profile；头像/状态控件承担启动、重启、错误入口；页面级动作只保留 Agent Defaults 和停止运行中的 Agent。
- 新建 Agent 使用渐进表单：基础层只问名称、头像、指令；AI 配置先选“继承默认 / 单独配置”；单独配置才显示 Harness、Provider、Model；高级层再显示 Skills、权限、并发、运行位置与环境变量。
- Agent 编辑器中的“单独配置”同时提供真实账号选择；工作权限也直接保存在 Agent 上。Team Pack 只选择已有 Agent 并描述协作关系，不能用角色里的账号、Skill 或角色快照覆盖 Agent 自身配置。
- Harness 的可用性、支持的 Provider/Model/Effort、外部 CLI 依赖与最大并发必须来自服务端 Runtime Catalog。前端不按 runtime id 猜能力，也不预渲染每种 Runtime 的空配置区。
- Settings 只管理账号、Skill Library、Runtime Catalog 诊断和全局默认等资源；Agent 对象本身的创建、编辑、活动与运行状态回到 Agents 一级页面。

视觉上采用桌面应用的三平面：全局侧栏、圆角主工作面、可折叠 Context Rail。保留本产品自己的色彩、图标和文案，不复制 Buzz 资产；真正复用的是对象层级、上下文分离、渐进披露和事实优先的交互。

## 十九、本地 Buzz Desktop v0.5.18 复核（2026-08-24，当前有效）

本节以已登录的本地 Buzz EXE 与同版本源码为证据，替代第十八节中“Desktop E2E 构建”的表述。复核范围包括全局导航、Inbox、Channel、Agents、Agent 创建、Agent Profile、Agent Defaults、Settings / Agents、Settings / Compute、Experiments，以及源码中的 Projects、Agent Pool、Event Queue、ACP、CLI 与 MCP 实现。未修改 Buzz 的账号、设置、Agent、Project 或消息数据。

产品定位上的结论不是“把 Buzz 变成我们的皮肤”，而是复用它对长期协作对象与执行对象的分层：Buzz 是 relay/community 中人和 Agent 的通用协作产品；我们是多个 Project 空间中的 Agent 交付产品。因此保留 Project、WorkItem、Artifact、Review/Gate 和 Agent，舍弃必须先创建的 Delivery 容器、频道化 Project、常驻主聊天与分散的 Agent 配置入口。

- **Project 可以创建，Delivery 不再创建。** Project 是长期目录、身份与协作边界；用户进入 Project 就可以提出目标、创建工作或请求 Agent。对外交付需要冻结批次时才创建可选 Release。
- **Agent 是一级对象。** Agents 页面负责目录、新建、Profile、指令、运行配置、Skills、所属 Project/团队、活动和运行状态。Settings 不再编辑 Agent 列表，只保存全局 Agent 偏好、默认配置与可用执行程序。
- **配置按对象归属。** Agent Profile 采用 `信息 / 执行 / 协作范围 / 记忆或活动` 的渐进页面；账号、模型、执行程序和 Skills 是 Agent 引用的资源，不再与 Agent 并列成需要用户手工拼装的主对象。
- **执行程序目录默认只显示已配置或可用项。** 一个“添加运行环境”动作在原位展开其他候选项；未安装的每种程序不得预渲染成空卡片。命令、路径、适配方式和协议能力只在诊断详情出现。
- **继承默认配置不是缺失配置。** Agent 未单独绑定模型账号、但选择继承本机运行环境时，Project 协作条和 Agent Profile 应显示“使用运行环境的登录状态”或等价可理解状态；不得显示“未绑定账号”并暗示 Agent 不可运行。只有用户选择单独配置且必需账号确实缺失时，才显示需要补充配置。
- **Compute 与 Agent 分离。** Compute 表达“哪台设备可以承载执行”；Agent 表达“谁、以什么指令和能力工作”；Runtime Catalog 表达“这台设备有哪些执行程序”。三者不得合并成一个配置表。
- **协作流负责触发，不负责宣告完成。** 在 Project 时间线中提及或请求 Agent 可以触发工作；任务、产物和评审事实通过结构化操作回到同一流。思考、工具输出、空闲、超时和普通文本只更新活动状态。
- **页面保持桌面连续性。** 左侧一级对象导航稳定，主面展示当前对象，右侧上下文面板按需出现；打开 Agent 对话不会替换 Project 的正式对象视图。创建、状态和诊断都在对象附近完成，不把用户送入内部 plumbing 页面。

当前页面验收顺序固定为：Workspace Activity → Agents Directory / Profile → Projects Overview → Project Object Workspace → Settings Runtime Catalog。任一页面若仍要求用户先创建 Delivery、在 Settings 中逐 Agent 组装 runtime，或把运行日志当作完成事实，均视为未完成重构。

## 二十、本地 EXE 端到端复核后的最终交互契约（2026-08-24，当前有效）

本节替代第十八、十九节中“Project 默认对象概览、Agent conversation 只作为按需侧面板”与“舍弃常驻主聊天”的判断。此前走查只观察了对象列表和配置页，没有沿一次真实 Agent 触发完整追踪到结果，因此错误地把参考产品的 Context Rail 布局当成了产品主链路。

本地 Buzz EXE 的真实链路是：`频道/私聊事件 → Agent 实例 → ACP session → 实时运行轨迹 → CLI 提交正式消息 → 同一消息上下文呈现结果`。Agent Profile 同时提供活动、运行、频道和记忆等对象视角；运行页展示 observed status、启动偏好、Harness、ACP command、权限、模型、实例和 MCP，但敏感环境值不进入主界面。这个设计稳定的原因是消息触发、运行观察和产品写入共享事件身份与上下文，而不是因为它“长得像 Telegram”。

结合本产品定位，页面契约冻结为：

- **Project 默认进入协作流。** 中心常驻消息与事实流，底部常驻输入；用户可以直接描述目标、提及 Agent 或继续已有工作，不先创建 Delivery，也不先打开右侧聊天抽屉。
- **正式对象是流上的可打开事实。** WorkItem、Artifact、Review/Gate 与 Release 由 CommandReceipt 产生，可作为卡片进入同一流，并在 `工作 / 评审 / 产物` 镜头中形成权威列表。镜头是过滤器，不是另一套工作台。
- **运行观察附着于 Agent 回复。** session、thinking、tool、usage、permission、retry 和错误进入可展开活动轨迹；它们帮助解释“正在发生什么”，不能宣告工作完成。
- **Agent Profile 默认打开活动。** 固定视角为 `活动 / 信息 / 运行 / 频道 / 技能`；活动聚合该 Agent 在不同 Project 的 Invocation 与回复，运行展示真实 supervisor/worker/session 观测，频道展示可触发它的协作范围。没有事实时显示空态，不伪造日志、内存或在线状态。
- **右侧 Context Rail 只承载上下文。** Project 路径、开放工作、Agent、阻塞和完成口径留在右侧；它不再承载主协作入口。窄窗口可折叠 Context Rail，但消息流与输入区保持主表面。
- **CLI 与 MCP 对用户不可分裂。** Agent 使用结构化 MCP 完成生命周期关键写入，使用 `ath` CLI 覆盖通用操作和逃生；两者的回执投影到同一事实流，用户无需知道该结果来自哪个 Adapter。
- **安全上不照抄缺陷。** Runtime UI 只显示环境变量名称、来源与“已配置”，任何 API Key、token、命令参数秘密和原始环境值一律掩码；辅助功能树、日志和诊断接口遵守同一规则。

首屏验收不再以统计卡是否齐全为标准，而以用户能否在 Project 中立即发起协作、看到 Agent 接纳与运行、分辨活动和正式事实、继续下一条要求为标准。

## 二十一、Buzz 全功能与创建逻辑复核（2026-08-25，当前有效）

本节来自对本地 Buzz Desktop v0.5.18 全局导航、Search、Inbox、Channel/DM/Huddle、Agents、Compute、Settings、Experiments、Projects、Tasks、Reviews 和 Workflows 的逐项交互，以及对 `buzz-cli`、`buzz-acp`、Project NIP、Workflow schema 和 runtime 源码的交叉验证。复核后已删除专用审计 Project，并把临时打开的 Projects/Workflows 实验开关恢复为关闭。

- **创建入口遵循对象作用域。** 全局可以创建 Project；Project 内创建 Task、Review 等对象；Channel/DM 中创建消息或触发 Agent。页面不使用一个万能表单收集所有层级，也不在子级弹窗重复询问已由父级确定的作用域。
- **创建结果必须以权威回执为准。** 创建工作和发起评审只有在服务端接纳、权威投影已经更新后才关闭弹窗；拒绝、网络失败或过期 revision 必须保留用户输入并原位提示，不能只写日志后制造“已经创建”的假象。
- **Project 是引用容器，不是 Delivery Run。** Buzz 先创建 Repository，再创建引用它的 Project；Repository、Task、Review、Channel 与 Contributor 通过真实引用聚合。我们不复制 Repository 必填限制，但采用稳定 Project identity 和显式 object reference；没有独立“创建交付”。
- **消息流是触发与反馈主链路。** Channel、DM 和 Huddle 共享连续流、线程、提及、草稿与 Agent picker；Agent 运行轨迹可以观察，正式结果由 CLI/产品命令写回同一上下文。我们的 Project 首屏因此保留常驻协作流，同时将工作、评审和产物保留为独立对象页签。
- **Inbox 是跨空间监督面。** All、Projects、Mentions、Threads、Needs action、Agents、Reminders 和 Drafts 不是第二套数据，而是统一事件投影的过滤器。我们的 Workspace Activity 将演进为 Inbox 投影，至少区分需要处理、Agent、评审和普通活动。
- **Inbox 不等于 Runtime 日志。** 人类消息、Agent 对人更新和 Work/Review/Blocker/Artifact 等业务事实可以进入跨空间监督面；`tool_use`、`tool_result` 只附着在 Project 内对应 Agent 回复的 Trace。历史工具投影必须由持久读模型对账清理，不能在页面按工具名称或“使用工具”文案隐藏。
- **Inbox 与对象镜头必须使用同一聚合。** “评审”筛选、Projects 计数、右侧待评审计数和 Reviews 镜头只消费独立 Review aggregate，不能用 `Task.status = in_review` 替代。读取失败时 Activity、Projects、Reviews 和 Context Rail 都显示失败/未知状态，不得伪装成业务空态、零条评审或继续展示旧计数。
- **读模型刷新必须有 generation fencing。** 初次加载、镜头切换和 Socket 刷新可重叠；只有最新请求可以更新 Review 列表、错误态和计数。旧成功响应不能覆盖较新的失败或恢复提示。
- **Agent 创建采用渐进披露。** 默认对话式创建只收集身份与职责；手动模式先收集头像、名称、指令和默认/自定义 AI 配置，高级层才出现权限、并行度、Pool 和环境变量。Agent Profile 统一信息、运行、协作范围、记忆/活动和 Skills；Settings 只管理账号、默认值、可用执行程序与 Compute。
- **Agent Profile 必须承载真实操作。** Profile 的主动作提供“发消息”；运行页基于 Runtime Supervisor 的 observed state 提供停止和重启。停止必须同时取消当前 Agent 在目标项目中的活动 Invocation 并停止对应的受管 Runtime，重启必须沿用同一个 Agent、Project、Runtime Node 身份并提升 generation；不得只清除前端状态。控制请求被接纳不等于实例已经恢复：若重启后的 observed state 为 `failed`，页面必须显示失败告警与脱敏原因码，不能给出“重启成功”的绿色假象。
- **Agent Team 是产品对象，不向用户暴露 Team Pack。** 创建、编辑、导入、导出、部署和删除统一使用 Agent Team 术语；创建与部署都经 Command Kernel 返回可重放 receipt。Team 只引用已有 Agent，不复制账号、模型、Skills 或 Runtime；成员不存在或成员 Runtime 不在 Catalog 时必须拒绝创建/部署，不能从 Team 角色快照临时合成一个“看似可运行”的 Agent。部署成功后必须显示目标项目和已部署成员，并能在项目上下文中看到同一 Team identity。
- **自定义 ACP Harness 是 Runtime Catalog 的创建路径。** 用户只填写名称、命令和参数；凭据与私密环境配置归模型账号/凭据服务，Catalog 文件不保存环境值，Harness 进程也不继承桌面服务的完整环境。保存、冲突校验、可用性探测与 Agent 选择读取同一个服务端 Catalog；更新或删除 Catalog 项时先停止并注销所有旧实例，下一次触发必须按新配置创建。UI 不接受安装脚本，不回显秘密值，也不把未知 Harness 静默映射为内建 Runtime。
- **失败队列必须可见且可恢复。** Agent 工作超过运行时启动重试上限后留在 Project 的运行诊断中，显示目标 Agent、关联 Work、稳定原因码、尝试次数与失败时间；用户显式“重新入队”才能恢复。打开 Work 或 Artifact 时必须同时切换到其真实协作作用域，不能因详情面板的作用域保护表现为无响应。
- **Workflow 是事件图，不是后台脚本列表。** Message/Reaction/Diff/Webhook/Schedule 触发器、条件和 action 都引用统一事件上下文，并有 loop prevention。Buzz v0.5.18 的 `RequestApproval` 尚未持久化恢复 token，`send_dm`/topic action 仍未闭环；我们的 Gate 等待必须持久、可恢复并由 CommandReceipt 终结，不能照搬这个缺口。
- **桌面体验由连续性保障。** 全局快捷键、Local archive、通知、更新、移动配对、Terminal dock、Agent/Compute 状态和对象深链共同让用户不离开当前上下文。Web 与桌面继续共用 Renderer，但桌面验收必须逐项验证键盘、弹层、返回、滚动、创建、状态恢复和本地进程能力。

页面实现的硬性验收是：所有既有高价值能力仍有明确入口；全局只有“添加项目”一个主创建动作；Project 内存在就地的工作/评审创建；Settings 不编辑 Agent 对象；协作流、对象事实和运行观察在视觉与数据类型上均可区分。

创建链路进一步冻结为同一条产品协议：Project 内“创建工作”直接提交 `work.create` Product Command，成功后从服务端权威投影重新加载并打开对象；页面不得再调用旧 Workspace Store 生成另一份任务身份。Agent Runtime 的停止/重启按 Project 实例逐行操作，页面显示项目名称而不是 scope id；返回的局部 snapshot 只替换该 Project 的实例，不能误删同一 Agent 在其他 Project 的运行状态。

Agent 创建同样冻结为对象协议，而不是 Settings 配置拼装：基础层是头像、名称、完整工作指令；AI 层先选择继承默认或单独配置，单独配置才显示 Runtime Catalog 中的 Harness 与模型；高级层包含指令发送范围、并行度、实例命名池、Skills 和工作权限。仅有本机 Compute 时不显示 `Run on`。工作指令直接成为 Prompt 的 Agent 身份层，不再经过角色素材编译。导入 Agent 先成为可检查草稿，最终仍走 `agent.create`；有改动的草稿关闭前必须确认，命令拒绝或 revision conflict 必须保留输入。

## 二十二、WorkItem 列表而非任务仪表盘（2026-08-26，当前有效）

本节来自对本地 Buzz EXE 的对象行交互以及同版本 `ProjectWorkItemRow`、`ProjectEntityListRow`、状态分组和右侧上下文详情实现的交叉复核。采用的是它“列表扫描、详情理解”的产品分工，不复制源码、样式 token、品牌或文案。

- Project 的“工作”镜头只做一件事：让用户快速看清有哪些正式工作、处于什么阶段、由谁负责，并能直接打开。顶部四张统计卡、独立正式产物统计卡和重复完成口径说明全部移除；跨 Project 的组合统计继续属于 Workspace 监督面。
- WorkItem 按生命周期分组。组标题提供阶段名称与数量，行首进度图形提供快速形状识别；不在同一行尾再放一个重复状态徽章。阻塞阶段使用高显著性颜色，其余阶段保持低噪声。
- 一行只保留一个主标题。类别作为弱标签；描述、负责人、产物数和更新时间属于次级元数据，并在较窄空间按优先级逐步隐藏。内部 Task ID、Conversation、Runtime、路由和完成规则不进入列表主界面。
- 整行是打开统一任务详情的主点击区，键盘聚焦、可感知的生命周期名称与选中态必须可见；深入的依赖、证据、评审、进度请求和状态操作继续由已有 Task Detail 承担，不在列表卡片中复制。WorkItem 身份由 `conversationId + taskId` 共同确定，打开详情必须原子切换这两个字段；编辑、状态、进度请求与删除沿用同一复合身份和 mutation epoch，裸 `taskId` 不能作为跨 Project 的唯一身份。
- 没有工作时保留一个就地创建动作和解释性空态；有工作时页面顶部仅保留紧凑标题、开放工作数量和一个创建入口，不再恢复仪表盘。Project 顶栏与工作列表不得同时提供相同创建动作。
- 工作镜头作为 Project 主工作区中的命名区域，不再嵌套第二个页面主地标；屏幕阅读器应只遇到应用级主内容，并能从工作行的可访问名称获知生命周期状态。
- WorkItem 详情中的执行任务不是无语义的扁平清单：每行明确展示可理解的 Task 状态；存在依赖时展示“等待：上游任务”或“依赖已满足”。依赖只解释为何尚未派发，不改变已接纳任务的状态。
- A2A 的“已确认接纳”只表示一次派发回执，不能覆盖或替代 Task 的真实执行状态。若 Task 已有负责人但仍停留在 `proposed`，详情顶部显示“计划已分配但尚未激活”的一致性告警，方便恢复机制或人工处理，而不是继续呈现一切正常。
## 二十三、正式交付件与验证证据分离（2026-08-30，当前有效）

“产物”镜头只展示用户可打开、可交付和可追责的对象，并继续按产出角色分列。源码、设计稿、文档、
Review 与 Pull Request 可以成为正式产物；`cmd:`、`test:`、`trace:`、`proof:`、`live-db:`、`disk:`
和 `e2e:` 等验证引用只用于 Gate、评估和诊断下钻，不生成独立产物卡片。

同一 canonical 文件无论来自运行时工具观察、Task Artifact 或 Outcome evidence，都只显示一张卡，
并合并负责人、工作项、操作和最新时间。验证与评审角色列不能成为命令输出和日志碎片的收纳区；
没有正式对象时显示明确空态，并从 Review/Gate 或评估详情查看验证证据。
