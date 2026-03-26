# Saleae Logic 触摸板轨迹追踪工具

通过 Saleae Logic Pro 16 硬件采集 I2C 数据，实时解析并显示触摸板手指轨迹。支持实时显示、录制、回放 Saleae 导出的数据文件。

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
├── touchpad-tracker/              # Electron 触摸板轨迹追踪应用
│   ├── src/
│   │   ├── main.ts              # 主进程：UDP 接收 + 手指包解析
│   │   ├── App.tsx              # 主应用界面
│   │   ├── components/
│   │   │   ├── TrajectoryView.tsx   # 实时轨迹绘制组件
│   │   │   ├── PlaybackView.tsx     # 回放轨迹绘制组件
│   │   │   └── PlaybackControls.tsx # 回放控制组件
│   │   ├── hooks/
│   │   │   ├── useRecorder.ts       # 录制逻辑
│   │   │   └── usePlayer.ts         # 回放逻辑
│   │   ├── types/
│   │   │   ├── finger.ts            # 手指数据结构
│   │   │   └── recording.ts          # 录制文件结构
│   │   └── utils/
│   │       └── parseSaleaeTXT.ts    # Saleae CSV 文件解析
│   └── ...
├── touchpad_coor_decode.md       # 触摸板坐标协议文档
└── docs/                         # 设计文档
```

---

## 快速开始

### 1. 安装依赖

```bash
cd touchpad-tracker
npm install
```

### 2. 启动应用

```bash
npm start
```

### 3. 配置 Logic 2

1. 打开 Logic 2 软件
2. 添加 I2C 分析器，设置 SCL=通道0, SDA=通道1
3. 在 Analyzers 面板中加载 `I2C Real-time Exporter` 扩展
4. 开始采集

应用会自动接收数据并显示轨迹。

---

## 功能说明

### 实时轨迹显示

- Canvas 绘制手指轨迹
- 多指颜色区分（5种颜色）
- 顶部状态栏显示：帧率、手指数、扫描时间、按键状态
- 每个手指的坐标实时显示在状态栏
- **支持笔（Stylus）轨迹显示**

### 笔轨迹显示

- 笔数据与手指数据同时显示
- **笔状态**：release / hover / tip
- **颜色区分**：Tip（白色）、Hover（红色）
- **点大小**：Tip 半径 1.5px，Hover 半径 0.5px
- **线宽**：0.5px
- 状态栏显示笔坐标 (X, Y)、压力 (P)、倾角 (TiltX, TiltY)

### 录制与回放

| 功能 | 说明 |
|------|------|
| 录制 | 按 R 键或点击 REC 按钮开始/停止录制 |
| 回放 | 点击 Open File 打开 JSON/CSV/TXT 文件 |
| 播放控制 | 支持播放/暂停、逐帧后退/前进 |
| 播放速度 | 10-500 Hz 可配置 |
| 滑轨跳转 | 点击进度条任意位置跳转 |

### 轨迹显示样式

- 每个坐标点显示为圆点
- FingerTouch: 圆点半径 2px
- LargeTouch: 圆点半径 4px
- 相邻点用线条连接（线宽 1px）
- 不同手指使用不同颜色
- **笔轨迹**：Tip 白色、Hover 红色

### 按键状态

- key_state=1 时右上角显示红色 "KEY DOWN" 提示

### 分辨率配置

- 可配置触摸板 Max X/Y 坐标（默认 3000x2000）
- 界面右上角输入框直接修改

### 笔解析模式

- **TP Mode**：使用字节3的状态值判断（0x20=Hover, 0x21=Tip）
- **MCU Mode**：根据压力值判断（pressure >= 100 为 Tip，< 100 为 Hover）
- 界面右上角下拉框切换

---

## 快捷键

| 按键 | 功能 |
|------|------|
| R | 开始/停止录制 |
| C | 清除所有轨迹（手指+笔） |
| K | 仅清除笔轨迹（实时模式） |
| 空格 | 播放/暂停（回放模式下） |
| ← | 逐帧后退（回放模式下） |
| → | 逐帧前进（回放模式下） |

---

## 文件格式

### JSON 格式（应用录制）

应用录制的文件为 JSON 格式：

```json
{
  "version": 1,
  "recordedAt": "2026-03-22T10:30:00.000Z",
  "config": { "maxX": 3000, "maxY": 2000, "stylusParseMode": "tp" },
  "frames": [
    {
      "timestamp": 1234567890,
      "packetType": 47,
      "slots": [
        { "fingerId": 0, "state": 3, "x": 100, "y": 200 }
      ],
      "fingerCount": 1,
      "scantime": 1000,
      "keyState": 0,
      "stylus": {
        "stylusId": 128,
        "state": 33,
        "x": 1500,
        "y": 1000,
        "tipPressure": 150,
        "xTilt": 10,
        "yTilt": -5
      }
    }
  ]
}
```

### Saleae CSV/TXT 格式（导出回放）

Saleae Logic 导出的 CSV 文件，每行一个字节数据：

```
Time [s],Packet ID,Address,Data,Read/Write,ACK/NAK
1.555302937500000,0,0x2C,0x2F,Read,ACK
1.555347500000000,0,0x2C,0x00,Read,ACK
1.555367500000000,0,0x2C,0x04,Read,ACK
...
```

**支持的 I2C 地址**：0x2C, 0x15, 0x5D（可配置）

### 配置 I2C 地址

如果触摸板使用不同的 I2C 地址，可以在界面右上角的 **I2C Addr** 输入框中修改：

- 输入十六进制如 `0x2C`
- 或输入十进制如 `44`

---

## 触摸板协议

支持两种格式的触摸板数据：

- **47字节格式**：包含手指长度、宽度、压力等信息
- **32字节格式**：仅包含基本坐标信息

详见 [touchpad_coor_decode.md](touchpad_coor_decode.md)

### 帧头识别

| 字节位置 | 值 | 说明 |
|---------|-----|------|
| 0 | 0x2F/0x20 | 手指包数据有效字节 |
| 1 | 0x00 | 固定值 |
| 2 | 0x04 | reportid, 0x04代表手指坐标 |

- **47字节包**: 帧头 `[0x2F, 0x00, 0x04]`
- **32字节包**: 帧头 `[0x20, 0x00, 0x04]`

### 状态定义

| 状态值 | 含义 |
|--------|------|
| 3 | 手指按下 (Finger Touch) |
| 2 | 大面积按下 (Large Touch) |
| 1 | 手指抬起 (Finger Release) |
| 0 | 大面积抬起 (Large Release) |

### 笔数据包（47字节）

**帧头**：`[0x2F, 0x00, 0x08]`

| 偏移 | 名称 | 说明 |
|-----|------|------|
| 0 | Packet length | 0x2F (低字节) |
| 1 | Packet length | 0x00 (高字节) |
| 2 | Report ID | 0x08 |
| 3 | Stylus Status | 0x20=Hover, 0x21=Tip, 0x00=Release |
| 4 | Stylus ID | 固定 0x80 |
| 5-6 | X[7:0], X[15:8] | X坐标 (小端) |
| 7-8 | Y[7:0], Y[15:8] | Y坐标 (小端) |
| 9-10 | Tip Pressure | 16-bit 小端 |
| 11-12 | X Tilt | 16-bit 小端 |
| 13-14 | Y Tilt | 16-bit 小端 |
| 15-46 | Reserve | 保留字节 |

---

## 工作原理

```
Logic 2 + Saleae HW
       ↓ I2C 帧
  HLA 扩展 (UDP:50000)
       ↓
  Electron Main Process
       ↓ IPC
  React Renderer (Trajectory View)
```

1. **HLA 扩展**：运行在 Logic 2 内部，将 I2C 帧实时序列化为 JSON，通过 UDP 发送
2. **Electron 主进程**：监听 UDP 50000 端口，解析手指包数据
3. **React 渲染进程**：接收数据并绘制轨迹

---

## 故障排除

### Q: HLA 扩展加载失败

- 确认 `i2c_hla` 文件夹已复制到 `~/Library/Application Support/SaleaeLogic/Extensions/`
- 重启 Logic 2

### Q: 应用无法接收数据

- 检查 Logic 2 中 HLA 是否启用
- 确认防火墙允许 50000 端口
- 确认应用已启动并显示 "UDP Connected"

### Q: 无法打开录制文件回放

- 确认文件格式为支持的类型（.json, .csv, .txt）
- 检查 Saleae 导出时选择 I2C 协议分析
- 确认 I2C 地址与触摸板实际地址匹配

### Q: 解析 CSV 文件返回 0 帧

- 确认 CSV 文件包含正确的 I2C 地址列
- 检查 I2C Addr 配置是否与文件中的地址匹配
- 确认文件使用 I2C 协议分析导出（不是原始采样数据）

### Q: 播放时轨迹不正确

- 尝试调整播放速度（10-500 Hz）
- 检查触摸板分辨率配置（Max X/Y）是否正确

---

## 安装 HLA 扩展（可选）

如果不需要实时采集，只使用文件回放功能，可以跳过此步骤。

```bash
cp -r i2c_hla ~/Library/Application\ Support/SaleaeLogic/Extensions/
```

---

## 打包分享给他人

### Windows 用户

1. 在项目目录下运行打包命令：

```bash
cd touchpad-tracker
npm run make
```

2. 打包完成后，可执行文件位于 `out/make/squirrel.windows/` 文件夹中

3. 分发 `Touchpad Tracker.exe` 安装文件给其他人即可

### macOS 用户

```bash
cd touchpad-tracker
npm run make
```

打包完成后，安装文件位于 `out/make/zip/darwin/` 文件夹中

### Linux 用户

```bash
cd touchpad-tracker
npm run make
```

生成的文件位于 `out/make/zip/linux/` 文件夹中

### 注意事项

- 打包后无需安装 Node.js 或 npm，直接运行可执行文件即可
- Windows 版本依赖 Squirrel 运行时，但安装后会自带
- 打包前建议先测试 `npm run make` 是否成功

---

## 通道配置

| 信号 | 通道 |
|------|------|
| SCL  | 0    |
| SDA  | 1    |
