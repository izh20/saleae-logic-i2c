# Touchpad Tracker 录制回放功能设计

## 概述

为 Touchpad Tracker 添加录制和回放功能，支持实时录制手指轨迹数据，以及回放已录制的文件（包括 JSON 和 Saleae Logic 导出的 TXT 文件）。

## 数据格式

### JSON 录制文件结构
```json
{
  "version": 1,
  "recordedAt": "2026-03-22T10:30:00.000Z",
  "config": { "maxX": 1920, "maxY": 1080 },
  "frames": [
    {
      "timestamp": 1234567890,
      "packetType": 47,
      "slots": [
        { "fingerId": 0, "state": 3, "x": 100, "y": 200 },
        ...
      ],
      "fingerCount": 1,
      "scantime": 1000,
      "keyState": 0
    },
    ...
  ]
}
```

## UI 布局

```
┌─────────────────────────────────────────────────────────┐
│ ● Touchpad Tracker    [●REC] [▶PLAY]  [1.0x ▼]  帧率  │  ← 顶部工具栏
├─────────────────────────────────────────────────────────┤
│                                                         │
│                    Canvas 轨迹区域                       │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ [◀◀] [▶/⏸] [▶▶]  ━━━━━━━━●━━━━━━━━━  00:05/01:30    │  ← 底部播放控制条
└─────────────────────────────────────────────────────────┘
```

## 控制方式

| 操作 | 按钮 | 快捷键 |
|------|------|--------|
| 开始/停止录制 | REC 按钮 | R |
| 播放/暂停 | PLAY 按钮 | 空格键 |
| 逐帧后退 | ◀◀ 按钮 | Left ← |
| 逐帧前进 | ▶▶ 按钮 | Right → |
| 进度跳转 | 拖动进度条 | - |

## 播放速度

支持：0.25x, 0.5x, 1x, 2x, 4x

## 文件格式支持

1. **JSON 文件**：直接解析 `frames` 数组
2. **Saleae Logic TXT 文件**：解析格式 `{timestamp} {address} {data...}`，提取 I2C TX 数据

## 组件划分

| 组件 | 职责 |
|------|------|
| `Recorder` | 管理录制状态，收集帧数据，保存 JSON 文件 |
| `Player` | 管理回放状态，速度控制，帧间计时 |
| `PlaybackControls` | 播放按钮、进度条、速度选择 |
| `useRecorder` hook | 录制逻辑 |
| `usePlayer` hook | 回放逻辑 |

## 数据流

```
录制模式: UDP → parseFingerFrame → Recorder → JSON 文件
回放模式: JSON/TXT 文件 → Parser → Player → finger-frame → TrajectoryView
```

## 实现步骤

1. 创建 `useRecorder` hook 管理录制状态
2. 创建 `usePlayer` hook 管理回放状态和速度控制
3. 添加 `Recorder` 和 `Player` 组件到 App
4. 实现文件保存/加载功能
5. 实现 Saleae TXT 文件解析
6. 添加 UI 控制组件
