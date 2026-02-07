# 移动端无手柄拖拽 UI 规范

## 1. 目标
- 默认不显示手柄，保证编辑界面干净。
- 在移动端实现“无感拖拽”：低学习成本、低误触、和桌面行为一致。
- 不改变现有块隔离规则（列表/任务/引用/callout/table/code/math 的投放约束保持不变）。

## 2. 交互原则
- `可发现性`：通过左侧隐形热区 + 轻微触觉反馈，让用户可自然学会拖拽。
- `防误触`：正文区域仍用于光标/选词；只有热区长按进入拖拽。
- `一致性`：视觉提示和功能判定同源，不出现“能看到定位线但不能放”的情况。

## 3. 手势与触发
### 3.1 触发区域
- 每个可拖拽块左侧设置隐形热区（不渲染图标）。
- 热区仅在移动端生效（触屏设备 + 窄视口）。

### 3.2 触发条件
- `长按`进入拖拽准备态；长按后再移动超过阈值才正式开始拖拽。
- 正文区域长按保留系统选词行为，不劫持。

### 3.3 取消条件
- 第二根手指触碰屏幕。
- 系统选词菜单/上下文菜单弹出。
- 手势中断（`touchcancel`/`pointercancel`）。

## 4. 状态机
- `idle`：普通编辑态。
- `press_pending`：左侧热区长按计时中。
- `drag_active`：已激活拖拽，显示拖拽反馈和落点线。
- `drop_commit`：释放并执行移动。
- `cancelled`：取消并恢复 UI。

状态转移：
- `idle -> press_pending`：pointerdown 命中热区。
- `press_pending -> drag_active`：长按到时 + 位移超过阈值。
- `press_pending -> cancelled`：提前抬起/位移过大/触发选词。
- `drag_active -> drop_commit`：pointerup 且落点有效。
- `drag_active -> cancelled`：pointercancel/非法状态。

## 5. 视觉规范
### 5.1 默认态
- 不显示任何手柄元素。
- 不预留手柄占位，不产生额外 `padding-left`。

### 5.2 拖拽激活态
- 被拖块：轻微抬起（阴影 + 透明度变化）。
- 落点：单一定位线（必要时列表高亮框）。
- 非法落点：不渲染定位线。

### 5.3 动效
- 仅保留短时过渡（100ms~160ms），避免“漂浮感”过强。
- 落位后可选轻触觉反馈（设备支持时）。

## 6. 参数常量（建议默认值）
| 常量 | 默认值 | 建议范围 | 说明 |
|---|---:|---:|---|
| `MOBILE_DRAG_HOTZONE_WIDTH_PX` | `24` | `20-28` | 左侧隐形热区宽度 |
| `MOBILE_DRAG_LONG_PRESS_MS` | `200` | `180-260` | 长按触发时长 |
| `MOBILE_DRAG_START_MOVE_THRESHOLD_PX` | `8` | `6-10` | 长按后开始拖拽的最小位移 |
| `MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX` | `12` | `10-16` | press_pending 阶段超阈值则取消 |
| `MOBILE_EDGE_AUTOSCROLL_ZONE_PX` | `56` | `48-72` | 自动滚动边缘区域 |
| `MOBILE_EDGE_AUTOSCROLL_MAX_PX_PER_FRAME` | `18` | `12-24` | 自动滚动最大速度 |
| `MOBILE_DRAG_FEEDBACK_OPACITY` | `0.9` | `0.85-0.95` | 被拖块透明度 |
| `MOBILE_DRAG_FEEDBACK_SCALE` | `0.99` | `0.97-1.0` | 被拖块缩放 |

## 7. 代码落点建议（对应当前架构）
- `src/editor/handlers/DragEventHandler.ts`
  - 增加移动端 `press_pending` 状态与计时器管理。
  - 统一处理 pointer/touch 触发与取消。
- `src/editor/managers/DecorationManager.ts`
  - 移动端默认不创建/不显示手柄 decoration。
- `src/editor/managers/DropIndicatorManager.ts`
  - 保留现有定位线逻辑，仅在 `drag_active` 时显示。
- `src/editor/handlers/DropTargetCalculator.ts`
  - 继续复用现有落点判定与容器策略，不做视觉和功能双轨判断。

## 8. 不做项（本轮）
- 不新增可见的移动端手柄按钮。
- 不改动容器策略与块隔离规则。
- 不引入新的设置项（先用常量，稳定后再开放配置）。

## 9. 验收清单
- 移动端默认界面无手柄、无额外左侧占位。
- 左侧热区长按可稳定拖拽；正文长按仍能选词。
- 非法落点不显示定位线，合法落点显示且可成功放置。
- 列表根节点拖到自身末尾不会通过自嵌套产生缩进。
- 自动滚动在长文档中可用，且不会跳动。
