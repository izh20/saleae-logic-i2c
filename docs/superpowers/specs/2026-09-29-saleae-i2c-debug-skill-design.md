# Saleae I2C 调试 Skill — 设计文档

日期：2026-09-29
状态：已确认设计，待写实施计划

## 1. 目标

创建一个 Claude Code skill，把「Saleae 抓 I2C 波形 → 时序分析 → 定位到源码」这条链路自动化。

使用者不需要手动在 Logic 2 GUI 里点选分析器、导出 CSV、再人肉比对代码。一次对话即可完成：

1. 驱动 Logic 2 采集（或读取已有抓包/实时流）
2. 做协议与时序分析，输出违规清单和统计
3. 把波形事务映射回源码位置，或反向用波形验证代码假设

## 2. 范围

### 2.1 是

- **通用 I2C 工具**：任意 I2C 设备、任意源码树。核心分析引擎不知道任何具体设备协议。
- 三种数据入口：Automation API 自动采集、离线文件（`.sal` / CSV / TXT）、UDP 实时流。
- 协议违规检测 + I2C 时序参数测量。
- 波形 ↔ 源码双向映射。
- Profile 机制（`.i2c-profile.toml`）承载设备相关的通道映射、地址、寄存器语义。

### 2.2 不是（明确不做）

- **不实现 Live 流式 WebSocket API**。当前 gRPC 包（`logic2-automation` 1.0.11）无流式接口，WebSocket API 需额外依赖且复杂度高。实时场景复用现有 HLA + UDP 方案，定位为「看偶发错误的粗粒度通道」。等实测发现精度不够再升级。
- **不复用本仓库的 TypeScript 解析器**。`touchpad-tracker/src/hid/HidI2cSequenceAnalyzer.ts` 与 `utils/parseSaleaeTXT.ts` 逻辑完整，但绑定 TS + Electron IPC。Python 重写分析核心，把这两个文件当作参考规范阅读。代价是部分重复劳动，收益是 skill 可脱离本仓库独立使用。
- **不做波形可视化绘图**。输出是文本/Markdown 报告，图形交给 Logic 2 GUI。
- **不自动修改被调试的源码**。映射引擎只输出候选位置和证据，改动由人决定。

## 3. 技术底座（已实测验证）

环境事实，实施时不要重新假设：

| 能力 | 状态 |
|---|---|
| Saleae Logic 2 应用 | `/Applications/Saleae Logic.app`，版本 2.4.43 |
| `logic2-automation` | 1.0.11，装于 `/opt/homebrew/lib/python3.14/site-packages/saleae`，默认 `python3` 是 3.14.6 可直接 import |
| `Manager.launch()` / `Manager.connect(address, port=10430)` | 可用 |
| `Manager.start_capture(device_configuration, device_id, capture_configuration)` | 可用 |
| 采集模式 | `TimedCaptureMode(duration_seconds)`、`ManualCaptureMode()`、`DigitalTriggerCaptureMode(trigger_type, trigger_channel_index, ...)` |
| `Manager.get_devices(include_simulation_devices=True)` | 可用；**模拟设备存在，无硬件也能跑通采集路径** |
| `Capture.add_analyzer(name, label, settings)` | 按 UI 名称精确匹配；I2C 分析器设置键需在实施时实测确认 |
| `Capture.export_data_table(filepath, analyzers, columns, filter, iso8601_timestamp)` | 解码后带时间戳的表格 |
| `Capture.export_raw_data_csv(directory, digital_channels, analog_channels, ...)` | **原始边沿数据**，做精确时序测量用 |
| `Capture.save_capture(filepath)` / `Manager.load_capture(filepath)` | 存/读 `.sal` |
| WebSocket 流式 API | 不可用（`websockets` / `websocket-client` 均未安装） |
| 已有 HLA | `~/Library/Application Support/SaleaeLogic/Extensions/i2c_hla`，推 UDP 50000 |

可用测试素材（真实抓包）：

- `~/Documents/lenovo开机时序.sal`
- `~/Documents/hp008 palm.sal`
- `~/Downloads/友商.sal`

## 4. 架构

### 4.1 总览

```
                 ┌──────────────────────────────────────┐
 入口1 自动采集 →│ i2c_capture.py  (Automation API/10430)│─┐
 入口2 离线文件 →│ i2c_ingest.py   (.sal / CSV / TXT)    │─┼→ transactions.json ─┐
 入口3 实时流   →│ i2c_live.py     (UDP/50000, 复用 HLA) │─┘   （唯一中间格式）  │
                 └──────────────────────────────────────┘                     │
                                                                              ▼
                                          ┌───────────────────────────────────────┐
                                          │  i2c_analyze.py   时序/协议违规 + 统计  │
                                          │  i2c_map.py       波形 ↔ 源码 映射      │
                                          └───────────────────────────────────────┘
                                                                              │
                                                              report.md + report.json
```

**设计支点**：无论数据从哪来，先归一化成同一个 `transactions.json`，分析和映射引擎只认这一种格式。三个入口因此互不耦合，分析引擎可被独立测试（喂手工构造的 JSON）。

### 4.2 归一化格式

关键决策：保留**逐事件 + 单字节时间戳 + ACK 位**，而不只是 `addr + data`。

原因是时序参数（`tSU;DAT` / `tHD;DAT` / `tLOW` / `tHIGH` / `tBUF`）必须靠逐字节的时间信息才算得出来。现有 HLA 方案只推 `addr`/`data` 字节、丢弃 ACK、时间戳只有帧起始时间，做不了真正的时序分析 —— 这正是要解决的问题。

```json
{
  "version": 1,
  "source": "automation | sal | csv | udp",
  "captured_at": "2026-09-29T10:00:00Z",
  "meta": {
    "scl_channel": 0,
    "sda_channel": 1,
    "digital_sample_rate": 100000000,
    "device": "Logic Pro 8",
    "profile": "touchpad",
    "source_file": "/path/to/capture.sal",
    "timing_fidelity": "decoded | raw"
  },
  "transactions": [
    {
      "index": 0,
      "addr": 44,
      "addr_hex": "0x2C",
      "rw": "W",
      "start_time": 0.0012340,
      "end_time": 0.0013100,
      "repeated_start": false,
      "bytes": [1, 32],
      "events": [
        {"t": 0.0012340, "type": "start"},
        {"t": 0.0012352, "type": "address", "ack": true},
        {"t": 0.0012360, "type": "data", "value": 1,  "ack": true},
        {"t": 0.0012368, "type": "data", "value": 32, "ack": false},
        {"t": 0.0012376, "type": "stop"}
      ],
      "flags": ["data_nack"]
    }
  ],
  "bus_idle_gaps": [
    {"after_index": 0, "duration": 0.0100}
  ]
}
```

字段约定：

- 时间单位统一为**秒**（浮点）。Saleae 原生数据表可能给采样点或秒，归一化时统一。
- `events[].type` 取值：`start` / `address` / `data` / `stop` / `nack` / `error`。
- `ack` 字段：`true` 为 ACK，`false` 为 NACK。来源不含 ACK 信息时为 `null`（明确表示未知，不要默认成 `true`）。
- `timing_fidelity`：`decoded` 表示来自数据表（时间戳精度受解码器限制）；`raw` 表示来自原始边沿导出（可做 ns 级测量）。分析引擎据此决定哪些检查可信。
- `flags` 由分析引擎回填，用于报告索引。
- `profile` 为 `null` 时表示无设备语义，走纯通用分析。

### 4.3 分析引擎

`i2c_analyze.py`，输入 `transactions.json`，输出 `report.md` + `report.json`。

**协议违规检查**（每条含 severity：`error` / `warn` / `info`）

| 检查 | 触发条件 |
|---|---|
| `ADDR_NACK` | 地址字节未被应答 |
| `DATA_NACK` | 数据字节未被应答 |
| `UNEXPECTED_START` | 事务中途出现 START |
| `NO_STOP` | 采集结束仍无 STOP |
| `BUS_HANG` | SDA 长时间被拉低不放，或 SCL 被持续拉低 |
| `MISSING_RESTART` | 写后紧接读却用了 STOP + START 而非重复起始位 |
| `CLOCK_STRETCH_LONG` | SCL 低电平超阈值（阈值由 profile 或参数给） |
| `IDLE_TOO_SHORT` | 事务间隔 < `tBUF` |

**时序参数测量**

从 `events` 的相邻时间戳推导，逐事务计算并汇总（min / max / mean / 违规计数）：

- SCL 频率（由 `tLOW + tHIGH` 推导）
- `tLOW` / `tHIGH`（SCL 低/高电平时间）
- `tSU;DAT` / `tHD;DAT`（数据建立/保持）
- `tSU;STA` / `tHD;STA` / `tSU;STO`（起始/停止位建立保持）
- `tBUF`（总线空闲时间）

**总线模式阈值**内置于 `references/timing-specs.md`，支持 `--bus-mode {standard|fast|fast-plus|high-speed}` 切换，profile 可覆盖。

**重要保真度约束**：数据表导出的时间戳精度受 I2C 解码器限制。当 `timing_fidelity == "decoded"` 时，报告必须显式标注哪些时序结论是估算。`tSU;DAT` / `tHD;DAT` 这类 ns 级参数在 decoded 模式下不可信，只有在 `raw` 模式（`export_raw_data_csv()` 取的原始边沿）下才给出确定结论。宁可在报告里说「测不了」，也不要给假精度。

**统计**：事务频率、地址分布、读写比例、字节数分布、NACK 在时间轴上的聚类（偶发问题往往有时间规律，聚类能暴露出来）。

### 4.4 源码映射引擎

`i2c_map.py`，两个方向。

**正向：波形 → 源码**

1. 从 `transactions.json` 提取「事务指纹」：(addr, rw, 字节序列, 首个数据字节即寄存器地址, 事务相对顺序与间隔)。
2. 在源码树里搜索 I2C 原语调用点，按语言/生态匹配：

   | 生态 | 搜索目标 |
   |---|---|
   | Linux 内核驱动 | `i2c_transfer`、`i2c_master_send/recv`、`i2c_smbus_*`、`regmap_read/write`、`struct i2c_msg`、`I2C_M_RD` |
   | 裸机 / 厂商 SDK | `I2C_Write/Read`、`HAL_I2C_Master_Transmit`、`WriteReg`、`ReadReg`、`REG_WRITE` |
   | Windows HID-over-I²C | `HidI2c`、`IOCTL_HID_*`、`SpbWrite/Read` |
   | C# | `WriteI2C`、`ReadI2C`、`I2cDevice`、`WriteRead` |
   | Python | `smbus2`、`write_i2c_block_data`、`i2c_msg` |
   | Rust | `i2cdev`、`write_read`、`smbus` |

3. 对每个候选打分：地址字面量命中 + 寄存器常量命中 + payload 字节序列命中 + 与 I2C 原语的邻近度。

   地址字面量要考虑常见变体：`0x2C` / `0x2c` / `44` / `(0x2C << 1)` / `0x58`（左移后）。

4. 输出：按置信度排序的候选项列表，每项含 `file:line`、命中证据、置信度。

**反向：假设 → 波形证据**

使用者给一个自然语言假设（如「怀疑漏发 RESET 命令」），skill 读 `transactions.json` 回答 yes/no 并给出支撑数据。

这一方向**不做成固定脚本**，而是在 SKILL.md 里指导 Claude 用 `jq` / 临时 Python 查询归一化 JSON。原因是假设的形态无法穷举，硬编码成脚本会立刻过拟合。归一化格式保证了查询永远可行。

### 4.5 Profile 机制

`.i2c-profile.toml` 承载设备相关的一切，核心引擎不感知任何具体协议：

```toml
name = "touchpad"
bus_mode = "fast"
scl_channel = 0
sda_channel = 1
addresses = [0x2C, 0x15, 0x5D]

[timing_overrides]          # 可选，覆盖标准阈值
clock_stretch_max = 1.0e-3

[protocol]
kind = "raw"                # raw | hid-over-i2c

[registers]
"0x0001" = { name = "HID_DESCRIPTOR", len = 30 }
```

本仓库提供一份触摸板 profile（SCL=0/SDA=1、0x2C/0x15/0x5D、HID-over-I²C 命令寄存器 opcode）放 `assets/`，作为 `kind = "hid-over-i2c"` 的示例。阶段二实现 HID-over-I²C 语义解码。

## 5. 组件清单

Skill 落位于 `~/.claude/skills/saleae-i2c-debug/`（全局，因为定位是通用工具）。

```
saleae-i2c-debug/
├── SKILL.md                      # 触发条件 + 三条工作流 + 何时读哪个 reference
├── scripts/
│   ├── i2c_capture.py            # 入口1：Automation API 驱动 Logic 2 采集
│   ├── i2c_ingest.py             # 入口2：.sal / CSV / TXT → transactions.json
│   ├── i2c_live.py               # 入口3：UDP 实时流 → transactions.json
│   ├── i2c_analyze.py            # 时序 + 协议分析
│   ├── i2c_map.py                # 波形 ↔ 源码映射
│   └── i2c_profile.py            # profile 加载与校验
├── references/
│   ├── timing-specs.md           # I2C 各模式时序阈值表 + 保真度说明
│   ├── saleae-api.md             # Automation API 速查 + 常见错误码处理
│   └── source-mapping.md         # 源码映射启发式规则详解
└── assets/
    └── i2c-profile.example.toml  # 触摸板示例 profile
```

### 5.1 `i2c_capture.py`

参数：`--output`、`--duration`、`--trigger-channel` / `--trigger-type`、`--sample-rate`、`--scl` / `--sda`、`--simulate`、`--app-path`、`--no-launch`。

流程：`Manager.launch()`（或 `connect()`）→ `get_devices()` 选设备 → 构造 `LogicDeviceConfiguration` 与 `CaptureConfiguration` → `start_capture()` → `add_analyzer("I2C", settings={SCL, SDA, ...})` → `wait()` → `save_capture()` → `export_data_table()` → 交给 `i2c_ingest.py` 归一化。

错误处理：捕获并翻译 `MissingDeviceError`（没插硬件 → 提示用 `--simulate`）、`Logic2AlreadyRunningError`（改为 `connect()` 重试）、`IncompatibleApiVersionError`、`OutOfMemoryError`（建议降采样率或缩短时长）、`CaptureError`。

**待实测确认项**：I2C 分析器的 settings 键名。`add_analyzer` 要求键名与 UI 完全一致，实施时须实际调用一次枚举确认，不能照抄文档猜测。

### 5.2 `i2c_ingest.py`

按扩展名分发：`.sal` → `Manager.load_capture()` + `export_data_table()`；`.csv` / `.txt` → 解析数据表导出（需处理 Saleae 各版本列名差异，参考 `parseSaleaeTXT.ts` 的嗅探思路）；`.json` → 已归一化，透传；`.jsonl` → HLA UDP 流。

### 5.3 `i2c_live.py`

监听 UDP 50000，接收现有 HLA 的 JSON 流，增量转成归一化格式，可选实时打印违规，退出时落盘 `transactions.json`。

## 6. 错误处理原则

- **数据保真度优先**：不知道的信息标 `null`，不用默认值伪装已知。ACK 未知就是 `null`，不是 `true`。
- **宁可说测不了**：decoded 模式下不给 ns 级时序结论。
- **失败要可诊断**：Logic 2 未启动、设备未连接、分析器键名不匹配，都要给出可操作的具体提示，而不是抛栈。
- **不静默吞异常**：现有 `i2c_realtime.py` 的 `except: pass` 是反面样本，新代码不要模仿。

## 7. 测试策略

**素材**

- 真实抓包：`~/Documents/lenovo开机时序.sal`、`~/Documents/hp008 palm.sal`、`~/Downloads/友商.sal`
- Logic 2 模拟设备：跑通采集路径，不依赖硬件
- 合成用例：手工构造 `transactions.json`，注入已知违规（NACK、过短 `tLOW`、缺 STOP、总线卡死），断言分析器能检出对应 flag

**Eval prompts**（skill-creator 流程，with-skill vs baseline 对比）

1. 离线分析：「帮我看看 ~/Documents/hp008 palm.sal 里的 I2C 时序有没有问题」→ 期望产出报告、检出违规、给出时序统计
2. 自动采集：「用 Saleae 抓 3 秒 I2C 然后分析」→ 期望驱动 Automation API 走完整链路（无硬件时走模拟设备并说明）
3. 反向验证：「这段波形里 0x2C 的写是不是漏了 RESET 命令」→ 期望给出 yes/no + 数据证据

**断言**：报告文件生成、违规类型正确、时序参数算出且标注保真度、源码候选返回带置信度。

## 8. 分阶段

**阶段一（skill 本体）**：全部 6 个脚本（`i2c_capture.py`、`i2c_ingest.py`、`i2c_live.py`、`i2c_analyze.py`、`i2c_map.py`、`i2c_profile.py`）、SKILL.md、三份 references、示例 profile。三条入口路径全部跑通。

**阶段二**：HID-over-I²C profile 语义解码（opcode / 描述符序列识别）、时序阈值细化、live 入口增强。

## 9. 未决问题（实施时解决）

- I2C 分析器 `add_analyzer` 的确切 settings 键名（须实测枚举）。
- Logic 2 模拟设备能否产生有意义的 I2C 流量，还是只能验证「采集链路本身通」。若不能，采集路径的 eval 需要硬件在场，或降级为「验证命令构造正确」的单元测试。
- `export_raw_data_csv()` 在长采集下的文件体积（100 MS/s × 3 秒数字通道），是否需要按需裁剪时间窗。
