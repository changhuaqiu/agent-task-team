# Agent Task Hub 品牌视觉系统

> 日期：2026-07-21
> 状态：active
> 关联：[产品愿景](../vision.md) · [Agent OS 顶层设计](../../technical/agent-os-top-level-design-review.md)

## 1. 品牌任务

Agent Task Hub 的视觉必须让第一次来到 GitHub 首页的人立即感到：

> 这里运行的不是一组聊天窗口，而是一套能把软件目标持续推进到可验收结果的 Agent OS。

品牌主张：

> **让 AI 从会写代码，进化到能负责交付。**

适合海报的英文短句是 **From goal to evidence.**

## 2. 从参考项目学习什么

Polynoia 首页值得学习的是叙事方法，而不是具体画风：

1. 用一张宽幅主视觉建立产品世界观；
2. 用一句短主张解释画面；
3. 再用真实产品截图证明能力；
4. 主视觉表达核心信念，不罗列功能。

Agent Task Hub 不复制其人物、材质、场景和构图。我们的差异是：**Team Harness 是 Agent 团队持续工作并对完整交付负责的环境。**

## 3. 核心母题：Harness Habitat

Harness 不是四个 Agent 经过的一台机器，而是他们共同进入、协作和持续工作的完整环境：

```text
人定义目标与验收
  → 目标进入 Team Harness
  → 四个角色在各自工作区接住责任
  → 环境提供上下文、任务、交接、状态与恢复
  → 规划、架构、实现、质量共同收口
  → 带证据的作品从另一端交付
```
### 四个元素角色

四个角色不是同一种吉祥物的换色版本，而是不同材质、轮廓和运动方式构成的元素生命：

| 角色 | 职责 | 元素与轮廓 | 动作 |
|---|---|---|---|
| Navigator | 项目统筹 | 星光、纸带与风 | 展开目标与验收，将任务排成计划和依赖 |
| Architect | 架构工程 | 岩石、陶土与金属 | 校准结构、schema、安全与性能边界 |
| Builder | 全栈开发 | 电流、生长纤维与木 | 把设计编织成真正可运行的产物 |
| Verifier | 质量保障 | 水、光学玻璃与棱镜 | 显现缺陷、执行验证并形成证据 |

它们对应当前 Mario、DK、Luigi、Peach 的职责，但品牌画面不使用这些名字，也不采用任何同名商业角色的形象或标志。

### Harness 环境

- **Goal Ingress**：人从环境外放入目标、验收、范围和授权；
- **Shared Work Surface**：四个角色围绕同一份交付事实协作；
- **Harness Substrate**：地面、墙体和工作设施中的任务轨道、存储格与状态结构；
- **Context & Memory Archive**：按角色和阶段亮起的分层资料格；
- **Handoff Points**：角色之间明确、可追踪的责任与产物交接；
- **Recovery Loop**：失败后回到修复点，而不是重新开始；
- **Proof Gates**：评审、测试、验收和回执；
- **Delivery Egress**：输出带四份组织化证据的完成产物。

人始终位于 Harness 环境之外，只定义目标和必要决策，不逐个调度 Agent。

## 4. 视觉语言

- 气质：温暖、可信、精密、有生命力，带适度奇想但不幼稚；
- 构图：约 `2.1:1`–`2.35:1` 的电影式剖面或微缩场景；
- 背景：graphite / midnight navy；
- 环境：暖木、陶瓷、织物、深色金属和克制内发光；
- 色彩：沿用 latte、amber、forest green、sky blue、lavender 和 rose 小面积强调；
- 图片内部不写核心文案，品牌名和主张由 README 的可访问文本承载。

禁止使用：机器人排排站、四只同类动物、四个人换色、Boss Agent、聊天气泡、SaaS Dashboard 拼贴、代码雨、无意义霓虹网络，以及任何现有动漫或游戏角色的形象。

## 5. README 叙事顺序

```text
品牌名 + 产品类别
→ 核心主张
→ Harness Habitat 主海报
→ 端到端实机演示
→ 为什么需要 Agent OS
→ 产品机制
→ 真实界面与交付证据
→ 快速开始
```

海报负责让人理解品牌世界观；真实界面和运行结果负责证明产品能力。两者不能互相替代。

端到端演示必须紧跟主海报，避免被长篇产品说明折叠到首页下方；主海报下同时保留一个明确的播放入口。演示覆盖“项目接入 → 工作创建 → 统筹拆解 → Agent 执行 → 按角色组织交付件 → 证据化完成”，使用真实桌面端界面，并在公开前移除用户名、绝对路径、凭证和其他本机信息。GitHub 首页使用轻量 GIF 作为自动播放预览，点击后打开高清 MP4；中英文 README 共用同一组演示资产。

## 6. 资产规范与成功标准

- 主文件：`docs/assets/brand/agent-task-hub-harness-habitat-hero.png`；
- 演示视频：`docs/assets/demo/agent-task-hub-e2e-walkthrough.mp4`；
- 演示预览：`docs/assets/demo/agent-task-hub-e2e-preview.gif`；
- 演示海报：`docs/assets/demo/agent-task-hub-e2e-poster.jpg`；
- 主视觉原始尺寸：1828 × 860 PNG；
- README 展示宽度：860px；
- 中英文 README 使用同一主视觉和各自的 alt 文本；
- 不看正文也能读出四个不同角色围绕同一目标共同交付；
- 统筹、架构、实现、质量可从材料与动作区分；
- Harness 必须读成角色赖以工作的完整环境，而不是第五个角色或中央机器；
- 图像不得包含文字、第三方 Logo、水印或无法验证的功能承诺。

## 7. 可复用生成 Brief

首版使用内置图像生成模式。后续迭代以此为基线，只做单项修改：

```text
Use case: stylized-concept
Asset type: ultra-wide GitHub README hero for Agent Task Hub

Create an original warm cinematic cutaway called “Harness Habitat.” Team Harness
is the complete shared environment where exactly four radically different elemental
AI characters turn one human goal into an evidence-backed software delivery.

Navigator: folded paper ribbons, warm starlight and air; orders goal and acceptance.
Architect: dark stone, terracotta and brass; calibrates structure and boundaries.
Builder: forest-green living fiber, wood and controlled blue electricity; builds.
Verifier: clear water, rose optical glass and lavender prisms; tests, reveals defects,
records four proof facets and routes rejected work back.

Show one shared artifact moving through four connected work zones. Build task rails,
handoff points, context and memory shelves, one recovery loop and a delivery exit into
the Habitat. A single human hand remains outside and only provides the goal.

Premium stylized 3D editorial illustration, handcrafted texture, soft cel shading,
sophisticated and quietly playful. Exactly four characters. They must not be four
animals, humans, robots or recolored copies of one body. No text, logo, watermark,
UI, dashboard, chat bubbles, code rain, boss character or generic neon network.
```
