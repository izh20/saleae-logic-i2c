# Saleae Logic I2C 实时采集工具

通过 Saleae Logic Pro 16 硬件采集 I2C 数据，实时解析并输出 HEX 数据。

## 硬件要求

- Saleae Logic Pro 16
- Saleae Logic 2 软件 (v2.4.43+)
- macOS

## 目录结构

```
.
├── i2c_hla/                      # Logic 2 HLA 扩展
│   ├── extension.json
│   └── i2c_realtime.py
├── i2c_udp_receiver.py           # UDP 接收器（实时显示）
├── touchpad-tracker/             # Electron 触摸板轨迹追踪应用
│   ├── src/
│   │   ├── main.ts              # 主进程：UDP 接收 + 手指包解析
│   │   ├── App.tsx              # 主应用界面
│   │   ├── components/
│   │   │   └── TrajectoryView.tsx   # 轨迹绘制组件
│   │   ├── hooks/
│   │   │   ├── useRecorder.ts       # 录制逻辑
│   │   │   └── usePlayer.ts         # 回放逻辑
│   │   └── types/
│   │       ├── finger.ts            # 手指数据结构
│   │       └── recording.ts         # 录制文件结构
│   └── ...
├── touchpad_coor_decode.md       # 触摸板坐标协议文档
└── docs/                         # 设计文档
    └── superpowers/
        ├── specs/                # 设计规格
        └── plans/                # 实施计划
```

## 通道配置

| 信号 | 通道 |
|------|------|
| SCL  | 0    |
| SDA  | 1    |

---

## 方案一：实时采集（推荐）

### 1. 安装 HLA 扩展

```bash
cp -r i2c_hla ~/Library/Application\ Support/SaleaeLogic/Extensions/
```

### 2. 配置 Logic 2

1. 打开 Logic 2
2. 添加 I2C 分析器，设置 SCL=通道0, SDA=通道1
3. 在 Analyzers 面板中加载 `I2C Real-time Exporter` 扩展
4. 开始采集

### 3. 启动 UDP 接收器

```bash
python3 i2c_udp_receiver.py
```

输出示例：

```
============================================================
I2C Real-time UDP Receiver
Listening on UDP port 50000
============================================================

Waiting for I2C data...
```

---

## 方案二：触摸板轨迹追踪应用

Electron + React 应用，实时显示触摸板手指轨迹，支持录制和回放。

### 启动应用

```bash
cd touchpad-tracker
npm install
npm run dev
```

### 功能说明

| 功能 | 说明 |
|------|------|
| 实时显示 | Canvas 绘制手指轨迹，多指颜色区分 |
| 录制回放 | 按 R 开始/停止录制，录制文件为 JSON 格式 |
| 速度控制 | 支持 0.25x, 0.5x, 1x, 2x, 4x 回放速度 |
| 逐帧控制 | 使用 ← → 方向键逐帧后退/前进 |
| 分辨率配置 | 可配置触摸板 Max X/Y 坐标 |

### 快捷键

| 按键 | 功能 |
|------|------|
| R | 开始/停止录制 |
| 空格 | 播放/暂停 |
| ← | 逐帧后退 |
| → | 逐帧前进 |

### 录制文件格式

录制文件为 JSON 格式，可使用应用回放，也支持解析后用于其他用途：

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
        { "fingerId": 0, "state": 3, "x": 100, "y": 200 }
      ],
      "fingerCount": 1,
      "scantime": 1000,
      "keyState": 0
    }
  ]
}
```

---

## 触摸板协议

支持两种格式的触摸板数据：

- **47字节格式**：包含手指长度、宽度、压力等信息
- **32字节格式**：仅包含基本坐标信息

详见 [touchpad_coor_decode.md](touchpad_coor_decode.md)

## 工作原理

1. **HLA 扩展**：运行在 Logic 2 内部，将 I2C 帧实时序列化为 JSON，通过 UDP 发送
2. **UDP 接收器**：监听 50000 端口，解析 JSON 并格式化输出 HEX 数据
3. **轨迹应用**：主进程接收 UDP 数据，解析手指包，通过 IPC 发送给渲染进程绘制轨迹

## 故障排除

**Q: HLA 扩展加载失败**
- 确认 `i2c_hla` 文件夹已复制到 `~/Library/Application Support/SaleaeLogic/Extensions/`
- 重启 Logic 2

**Q: UDP 接收不到数据**
- 检查 Logic 2 中 HLA 是否启用
- 确认防火墙允许 50000 端口
