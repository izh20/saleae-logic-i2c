# Saleae Logic I2C 实时采集工具

通过 Saleae Logic Pro 16 硬件采集 I2C 数据，实时解析并输出 HEX 数据。

## 硬件要求

- Saleae Logic Pro 16
- Saleae Logic 2 软件 (v2.4.43+)
- macOS

## 通道配置

| 信号 | 通道 |
|------|------|
| SCL  | 0    |
| SDA  | 1    |

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

---
--- START ---
  ADDR: 0x2c [R]
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0xb9 (185)
  DATA: 0x15 (21)
  DATA: 0x98 (152)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
  DATA: 0x0 (0)
--- STOP ---
```

## 文件说明

```
.
├── i2c_hla/
│   ├── extension.json       # HLA 扩展清单
│   └── i2c_realtime.py     # HLA 主程序（UDP 实时导出）
└── i2c_udp_receiver.py     # UDP 接收器（实时显示）
```

## 工作原理

1. **HLA 扩展**：运行在 Logic 2 内部，将 I2C 帧实时序列化为 JSON，通过 UDP 发送
2. **UDP 接收器**：监听 50000 端口，解析 JSON 并格式化输出 HEX 数据

## 故障排除

**Q: HLA 扩展加载失败**
- 确认 `i2c_hla` 文件夹已复制到 `~/Library/Application Support/SaleaeLogic/Extensions/`
- 重启 Logic 2

**Q: UDP 接收不到数据**
- 检查 Logic 2 中 HLA 是否启用
- 确认防火墙允许 50000 端口
