# HID I²C Device Control —— 影响范围评估

**日期：** 2026-06-23
**目的：** 在实施前确认 spec 是否会影响现有功能

---

## 1. 总体结论

| 现有功能 | 是否受影响 | 原因 |
|----------|------------|------|
| **TrajectoryView（Live 实时轨迹）** | ❌ 零影响 | 订阅 `finger-frame` 旧 IPC 通道；main.ts 旧逻辑不动 |
| **PlaybackView（回放）** | ❌ 零影响 | 同上 |
| **Frame List（录制时帧累加）** | ❌ 零影响 | App.tsx 中央总线订阅 `finger-frame` |
| **Debug 视图（16 通道调试）** | ❌ 零影响 | 同上 |
| **useRecorder（录制到 JSON）** | ❌ 零影响 | 同上 |
| **Power-On Seq Tab** | ❌ 零影响 | 用 `analyzeSequence` 全量分析，不订阅 IPC |
| **Device Desc Tab** | ❌ 零影响 | 静态解析 |
| **Report Desc Tab** | ❌ 零影响 | 静态解析 + .wara 互转 |
| **Report Data Tab（静态）** | ❌ 零影响 | 静态解析 |
| **Report Data Tab（实时）** | ⚠️ **需要小心** | 见 §2 |
| **Live Sequence Tab** | ⚠️ **需要小心** | 见 §2 |
| **localStorage 持久化（5 Tab 输入）** | ❌ 零影响 | 不涉及 |
| **HID Analysis Help 弹窗** | ❌ 零影响 | 文本更新，不影响逻辑 |
| **electron-store 配置** | ❌ 零影响 | 不涉及 |

---

## 2. ⚠️ 跨 Tab 交互问题（必须在实施时修复）

### 问题描述

`Report Data Tab 实时`（[HidAnalysisView.tsx:701](touchpad-tracker/src/components/HidAnalysisView.tsx#L701)）和 `Live Sequence Tab`（[HidAnalysisView.tsx:873](touchpad-tracker/src/components/HidAnalysisView.tsx#L873)）都按 `i2cAddress` 过滤 i2c-raw-frame：

```ts
// Tab 4 Report Data 实时
if (addrFilter !== null && rawFrame.i2cAddress !== addrFilter) return;

// Tab 5 Live Sequence
if (rawFrame.i2cAddress !== addr) return;
```

HID 来源的字节流**没有真实的 I²C 地址**（HID 协议不携带 I²C 7-bit 地址）。如果 spec §7.2 / §7.3 直接用 `i2cAddress: 0` 发出，会导致：

- **Tab 4**：用户 addr filter = 0x5D（HID 协议不带 i2cAddress）→ HID 字节流被静默丢弃
- **Tab 5**：用户 addr = 0x5D → 同上

**这是 spec 没有考虑的盲点**。必须修复。

### 修复方案：给 IPC 加 source 字段

**方案 A（推荐）**：

在 `I2cRawFrame` IPC payload 加 `source: 'udp' | 'hid'` 字段：

```ts
// types/electron.d.ts
export type I2cRawSource = 'udp' | 'hid';
export interface I2cRawFrame {
  timestamp: number;
  i2cAddress: number;
  isRead: boolean;
  register: number | null;
  rawBytes: number[];
  source: I2cRawSource;  // 新增
}
```

**改动**：
1. `main.ts` UDP handler：`source: 'udp'`
2. `main.ts` HID handler（新加）：`source: 'hid'`
3. `HidAnalysisView.tsx` Tab 4 / Tab 5 过滤逻辑：
   ```ts
   // Tab 4: HID 来源直接放过 i2cAddress 过滤
   if (rawFrame.source === 'hid') { /* process */ }
   else if (addrFilter !== null && rawFrame.i2cAddress !== addrFilter) return;
   
   // Tab 5: 同上
   if (rawFrame.source === 'hid') { /* process */ }
   else if (rawFrame.i2cAddress !== addr) return;
   ```

**影响范围**：
- ✅ Tab 4 Report Data 实时：i2cAddress 过滤对 HID 跳过（HID 来源直接进解析）
- ✅ Tab 5 Live Sequence：同上
- ❌ 其他 Tab（TrajectoryView / PlaybackView 等）：**零影响**——它们订阅 `finger-frame`，根本不订阅 `i2c-raw-frame`
- ❌ Power-On Seq / Device Desc / Report Desc / Report Data 静态：零影响——不订阅 IPC

**向后兼容**：现有 UDP 来源的帧自动 `source: 'udp'`，过滤逻辑不变。**0 回归**。

**实现成本**：~10 行（3 个文件各几行）

---

## 3. 现有功能不被影响的依据

### 3.1 IPC 通道隔离

```
[main.ts]
  - 'finger-frame' (旧通道, 已有) ──→ TrajectoryView / PlaybackView / Frame List / Debug / 录制
  - 'i2c-raw-frame' (新通道, 已有) ──→ Tab 4 Report Data 实时 / Tab 5 Live Sequence
  - 'hid-list' / 'hid-open' / 'hid-write' / 'hid-close' / 'hid-read-feature' / 'hid-descriptors' (本次新增)
                                       ──→ Tab 6 HID I²C Device
```

每个通道独立，**互不干扰**。

### 3.2 状态隔离

`LiveHidAnalyzer` 是 Tab 5 单独的实例。Tab 6 新建自己的 `LiveHidAnalyzer` 实例（独立 state，**与 Tab 5 不共享**）。两个 Tab 各自的 Start Listening 互不影响。

`finger-frame` 主进程 handler 路径**完全不动**（不引入新分支）。

### 3.3 localStorage 隔离

5 个 Tab 的 localStorage 键空间已经固定（`hid-analysis:tabN:field`）。Tab 6 用新的键空间 `hid-analysis:tab6:*`，不污染现有。

### 3.4 Help 弹窗 / README

仅文本更新，不影响任何运行时逻辑。

---

## 4. build pipeline 风险

| 风险 | 现状 | 影响 | 缓解 |
|------|------|------|------|
| **首次引入 native module** | 当前 0 个 native module（`@types/react-window` 只是 types；其他都是 JS） | 引入 `node-hid` 触发 `@electron/rebuild` 流程 | spec 已写明用 `@electron/rebuild` |
| **macOS build host 不能产 Windows binary** | 当前 build host 是 macOS，CI/release 也是 macOS | **Windows .exe 必须等 Windows 机器 build**——这是项目当前的限制（你看 commit log 一直只有 `darwin-arm64` zip） | 文档化；Windows binary 留给 Windows user build |
| **node-hid prebuild 在 Windows 64-bit + Node 20** | 官方 `node-hid@2.x` 提供 prebuild | 编译时不一定兼容 Electron 33 ABI | spec Step 1 验证；不通过回退 WebHID（spec §10 R1） |
| **electron-forge 旧版** | 项目用 `@electron-forge/cli@7.11.1` | `rebuildConfig` 字段已存在（line 18 空的 `{}`） | 只需填入 native module 名 |
| **asar 打包后 native module 路径** | `plugin-auto-unpack-natives` 已启用 | 自动处理 | 无需改 |

### 4.1 真实的构建风险

**当前 release pipeline 只在 macOS build**。引入 node-hid 后：
- macOS build：**不增加**风险（node-hid 在 macOS 也有 prebuild）
- Windows .exe：**首次**——需要 Windows 机器 build，否则用户用 macOS developer 机器 build 出来的 .exe 在 Windows 上跑不了

**但这不是新风险**——本项目所有 Windows binary 都是用户用 Windows 机器 build 出来的。spec 不改变这个现状。

---

## 5. 实施顺序的影响隔离

按依赖顺序，每步独立 commit + 验证：

| Step | 改动 | 影响 | 回退 |
|------|------|------|------|
| 1 装包 | `package.json` + `forge.config.ts` | **0 现有代码**——只是加 dep + rebuild config | `npm uninstall node-hid`，改 revert 即可 |
| 2 主进程 IPC | `main.ts` 加 6 个 `ipcMain.handle` | 现有 UDP handler 路径**0 改动** | diff 局部，可安全 revert |
| 3 preload + types | `preload.ts` + `types/electron.d.ts` | 加 6 个新 API，**不动现有** | 局部 revert |
| 4 渲染层 subTab | `HidAnalysisView.tsx` 加 `'hidDevice'` subTab + 状态 + JSX | 新加的 state / 组件不影响现有 Tab；过滤逻辑修要加 source 字段判断（已在 §2 修复方案） | 局部 revert |
| 5 build + verify | `tsc --noEmit` + `vite build` + `npm run rebuild` + `electron-forge make --mac` | 只 build 失败会暴露问题；现有 binary 不动 | 重 build |

**每步 commit 后**通过 `git log` + `git show` 检查本次 commit 的 diff 是否只动目标文件，不污染其他。`grep` 现有组件（TrajectoryView 等）确认无引用。

---

## 6. 实施后必跑的回归测试

| 测试 | 验证 |
|------|------|
| `tsc --noEmit` | 0 错 |
| `vite build` | 现有 Tab 行为不变 |
| `electron-forge make --mac` | 现有 macOS zip 仍产出（说明 native 重编不破现有） |
| 手动 smoke（5 个 Tab 一次过） | 见下表 |
| `git diff --stat` | 仅目标文件 + i2c-raw-frame 过滤逻辑（2 个文件） |

### 手动 smoke 测试矩阵

| Tab | 现有行为 | 是否仍正常 |
|-----|----------|------------|
| Live（TrajectoryView） | 触摸板事件实时显示 | ✅ 不动 |
| Playback（已加载 JSON） | 播放回放 | ✅ 不动 |
| Frame List（录制中） | 帧累加 | ✅ 不动 |
| Debug | 16 通道显示 | ✅ 不动 |
| Power-On Seq | 粘贴 → Analyze | ✅ 不动 |
| Device Desc | 粘贴 → Parse | ✅ 不动 |
| Report Desc | 粘贴 → Parse & Analyze | ✅ 不动 |
| Report Data 静态 | 粘贴 → Parse Report Data | ✅ 不动 |
| Report Data 实时 | Start Listening → 收实时帧 | ✅ **加 source 字段后行为不变** |
| Live Sequence | Start Listening → 收实时帧 + Save MD/JSON | ✅ **加 source 字段后行为不变** |
| **HID I²C Device（新）** | 选设备 → Connect → 发命令 → 收响应 | 🆕 新功能 |

---

## 7. 总结

**Blast radius 极小**：
- 5 个现有组件（TrajectoryView / PlaybackView / Frame List / Debug / Recorder）订阅的是 `finger-frame`，**完全不受影响**
- 4 个静态 Tab（Power-On Seq / Device Desc / Report Desc / Report Data 静态）零订阅 IPC，零影响
- 2 个实时 Tab（Report Data 实时 / Live Sequence）订阅 `i2c-raw-frame`——**需要加 `source` 字段过滤**（已识别，已设计修复方案）
- 5 个 Tab 的 localStorage 键空间不动
- Help 弹窗 + README 仅文本更新

**真实风险点**：
1. **Tab 4 / Tab 5 的 i2cAddress 过滤 vs HID 来源** — 必须修（已在 §2 给出方案）
2. **首次 native module 引入** — 通过 `@electron/rebuild` 处理；不通过回退 WebHID
3. **macOS build host 不能产 Windows binary** — 项目现状，spec 不变

**净影响**：3 个文件、~10 行额外改动（修 source 过滤）+ ~430 行新代码（spec 估算），5 个现有功能组件 0 改动。

**结论**：可以安全实施。修 §2 的 source 字段问题后，按 spec Step 1-5 推进。
