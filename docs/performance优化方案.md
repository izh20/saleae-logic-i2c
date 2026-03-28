# Windows 实时显示卡顿问题分析与优化

## Context
用户在 Windows 环境下使用工具时发现实时显示坐标延迟感较高，而 macOS 环境下相对正常。结合当前实现来看，问题更可能来自高频日志、渲染触发过多和 IPC/渲染链路放大，而不是单纯的 Canvas 重绘。

## 问题分析

### 主要瓶颈（按严重程度）

| 位置 | 问题 | 严重程度 |
|------|------|----------|
| main.ts:141-155 | 每帧输出多条 console.log，且对象较大 | Critical |
| main.ts:218 | DevTools 默认打开，进一步放大日志和渲染开销 | High |
| TrajectoryView.tsx:182-194 | 每帧 setStats()，触发 React 重渲染 | High |
| TrajectoryView.tsx:197 | 数据更新后立即 draw()，没有统一调度 | High |
| App.tsx:70-92 | 监听器会随状态变化重复订阅，存在抖动和短暂丢帧风险 | Medium |
| main.ts:142 | 每帧 JSON.parse()，在高频场景下有额外 CPU 开销 | Medium |
| main.ts:157 | 每个 UDP 包都直接 IPC send，没有背压或合并 | Medium |

### 需要修正的原始判断

1. **“双重渲染”不准确**：`setStats()` 触发的是 React 组件重渲染，`draw()` 是 Canvas 立即绘制，两者不是同一层面的重复渲染。
2. **“全清空并重绘 Canvas”不是根因**：2D Canvas 动画场景通常就是全量重绘，真正的问题是调用频率过高。
3. **“Windows 的 React 协调器更同步化”没有依据**：React 行为不应归因于操作系统差异。
4. **“setTimeout 精度”与当前主路径无关**：当前卡顿主要不是由定时器驱动逻辑造成。

### Windows 更容易暴露卡顿的原因

1. **DevTools + 高频 console.log**：Windows 上对象序列化、DevTools 展示和 UI 刷新开销更容易显现。
2. **主线程压力更集中**：主进程解析、日志、IPC 发送和渲染进程更新都在高频发生。
3. **渲染链路缺少节流**：没有把“数据处理”和“画面刷新”分开，导致每个包都驱动一次 UI 变化。

## 优化方案

### 1. 先移除高频日志和默认 DevTools
**目标**：先验证是否只是调试输出造成的假性卡顿。

- 删除或条件化 `main.ts` 里的每帧 `console.log`
- 不要默认调用 `mainWindow.webContents.openDevTools()`
- 只在调试模式下开启日志与 DevTools

### 2. 将数据处理和渲染分离
**目标**：数据帧必须全部处理（轨迹更新、release 清除），渲染按 vsync 频率刷新。

**核心原则**：节流边界必须在"数据处理之后、Canvas 绘制之前"，绝不能在 `handleFingerFrame` 入口处 return，否则会丢失 FingerRelease 事件导致轨迹永远不清除。

```typescript
// 在 TrajectoryView.tsx 的 handleFingerFrame 中
const pendingDrawRef = useRef(false);
const statsRef = useRef(initialStats);

const handleFingerFrame = useCallback((frame: FingerFrame) => {
  // ✅ 数据处理：每帧都执行，不跳过
  // ... 更新 trajectoriesRef、stylusTrajectoryRef、计算 frameRate ...

  // ✅ 暂存 stats 到 ref（不触发 React 渲染）
  statsRef.current = { frameRate, fingerCount, scantime, ... };

  // ✅ 渲染：RAF 合并，最多 ~60fps
  if (!pendingDrawRef.current) {
    pendingDrawRef.current = true;
    requestAnimationFrame(() => {
      pendingDrawRef.current = false;
      draw();                         // Canvas 绘制
      setStats(statsRef.current);     // 同步到 React state（也降到 60Hz）
    });
  }
}, [draw]);
```

**功能影响评估**：

| 功能 | 是否受影响 | 说明 |
|------|-----------|------|
| 轨迹数据完整性 | ✅ 不影响 | 数据写入 `trajectoriesRef` 在 RAF 之前，每帧都执行 |
| FingerRelease 清除轨迹 | ✅ 不影响 | `trajectories.delete()` 在数据处理阶段 |
| 录制功能 | ✅ 不影响 | `addFrame()` 在 App.tsx 层，与 TrajectoryView 独立 |
| 帧率计算 | ✅ 不影响 | `lastScantimeRef` 在数据处理阶段更新 |
| Canvas 画面延迟 | ⚠️ 增加最多 16ms | 从"立即绘制"变为"下一个 vsync"，实际感知很小 |
| C/K 清除轨迹 | ✅ 不影响 | 独立 keydown 事件，直接调用 `draw()` |

### 3. 降低 React 状态更新频率
**目标**：状态栏信息不必每个包都刷新。

- `stats` 改为按节流周期更新，**频率不低于 30Hz**
- 推荐方案：在方案 2 的 RAF 回调中一并更新 `setStats(statsRef.current)`，自然降到 ~60Hz
- 避免使用 `JSON.stringify()` 比较对象，开销过大

**各字段对延迟的敏感度**：

| 状态字段 | 对延迟敏感 | 说明 |
|----------|-----------|------|
| `frameRate` | 不敏感 | 数字显示，人不会感知毫秒级变化 |
| `fingerCount` | 不敏感 | 同上 |
| `scantime` | 不敏感 | 同上 |
| `keyState` | **中等敏感** | KEY DOWN 红色指示器依赖此值；≥30Hz 无问题，<10Hz 可能漏显短按 |
| `activeFingers` | 不敏感 | 坐标文字显示 |
| `stylus` | 不敏感 | 坐标文字显示 |

### 4. 让 IPC 发送更轻量
**目标**：减少主进程到渲染进程的高频消息压力。

- 保留单帧发送，但去掉冗余日志
- 如果后续仍卡顿，再考虑按 RAF 或微批次聚合发送
- 不建议直接用固定 `setInterval(16)` 作为核心机制，容易受系统定时器精度影响

**⚠️ 未来批量方案的兼容性提醒**：当前录制功能 (`useRecorder.addFrame`) 依赖"每个 IPC 消息对应一帧"。如果将来改成批量 IPC，渲染进程侧必须遍历 batch 中的每一帧分别调用 `addFrame()`，否则录制数据会丢帧。

### 5. 检查监听器生命周期
**目标**：减少不必要的订阅抖动。

当前 `App.tsx` 的 `useEffect` 依赖 `[playbackMode, isRecording, addFrame]`，每次切换录制/回放都会解绑旧监听器再注册新监听器，间隙内可能丢失 1-2 帧。

**推荐做法**：用 `useRef` 持有变化的状态值，让 `useEffect` 依赖数组变为 `[]`，从而只订阅一次：

```typescript
// App.tsx
const playbackModeRef = useRef(playbackMode);
const isRecordingRef = useRef(isRecording);
const addFrameRef = useRef(addFrame);

// 保持 ref 与最新值同步
useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);
useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
useEffect(() => { addFrameRef.current = addFrame; }, [addFrame]);

// 只订阅一次，回调内读 ref
useEffect(() => {
  const unsubscribe = window.electronAPI.onFingerFrame((frame) => {
    setConnected(true);
    if (!playbackModeRef.current && trajectoriesCallbackRef.current) {
      trajectoriesCallbackRef.current(frame);
    }
    if (isRecordingRef.current) {
      addFrameRef.current(frame);
    }
  });
  return () => unsubscribe();
}, []); // ← 空依赖，终身只订阅一次
```

**功能影响**：无。回调内通过 ref 读取的始终是最新状态值，行为与原实现完全一致，但消除了切换时的订阅间隙。

## 推荐实施顺序

1. **首先**：移除高频 `console.log`，关闭默认 DevTools
2. **其次**：把渲染节流改为 `requestAnimationFrame`
3. **再次**：降低 `stats` 刷新频率，减少 React 重渲染
4. **最后**：再评估是否需要 IPC 合并或更深度的架构优化

## 功能安全性总结

| 方案 | 安全性 | 功能影响 |
|------|--------|----------|
| 1. 移除日志/DevTools | ✅ 完全安全 | 零影响，纯调试代码 |
| 2. RAF 节流 | ✅ 安全 | Canvas 最多延迟 16ms（一个 vsync），轨迹数据完整 |
| 3. 降低 stats 刷新 | ✅ 安全（≥30Hz） | 状态栏数字刷新降频，KEY DOWN 指示器需保证 ≥30Hz |
| 4. IPC 轻量化 | ✅ 当前安全 | 未来若改批量发送需同步修改录制逻辑 |
| 5. 监听器生命周期 | ✅ 安全 | 消除切换间隙丢帧，行为与原实现一致 |

## 关键文件
- [touchpad-tracker/src/components/TrajectoryView.tsx](touchpad-tracker/src/components/TrajectoryView.tsx) - 主要渲染逻辑
- [touchpad-tracker/src/main.ts](touchpad-tracker/src/main.ts) - UDP 接收和 IPC 发送
- [touchpad-tracker/src/App.tsx](touchpad-tracker/src/App.tsx) - 订阅和模式切换逻辑

## 验证
1. 先关闭 DevTools 和高频日志，观察 Windows 卡顿是否明显改善
2. 用性能面板对比优化前后主线程占用和帧率稳定性
3. 再看是否仍存在输入延迟，再决定是否做 IPC 聚合