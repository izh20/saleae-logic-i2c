# Saleae I2C 调试 Skill 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Claude Code skill，把「Saleae 抓 I2C 波形 → 时序分析 → 定位到源码」这条链路自动化。

**Architecture:** 三个数据入口（Automation API 自动采集 / 离线 `.sal`+CSV / UDP 实时流）各自归一化成同一种 `transactions.json`，两个引擎（`i2c_analyze.py` 做协议与时序分析、`i2c_map.py` 做波形↔源码映射）只认这一种格式。归一化格式保留逐事件时间戳与 ACK 位，这是时序参数可计算的前提。

**Tech Stack:** Python 3.14（`/opt/homebrew/bin/python3`）、`logic2-automation` 1.0.11、gRPC（端口 10430）、Saleae Logic 2 2.4.43。测试用 `pytest`。

**Spec:** `docs/superpowers/specs/2026-09-29-saleae-i2c-debug-skill-design.md`

## Global Constraints

以下常量来自对 Logic 2 的**实测**（见「实测结论」节），实现时必须按此写，不要照抄网上文档或凭直觉改：

- **环境变量**：调用 `Manager.launch()` 前必须从子进程环境剥离 `ELECTRON_RUN_AS_NODE`。实测该变量被 Claude Code 的 shell 设为 `1`，会让 Logic 2 的 Electron 二进制以 Node 模式启动、拒绝 `--automation`、应用完全起不来、10430 端口不监听。
- **macOS 应用路径**：`Manager.launch(application_path=...)` 必须传二进制 `/Applications/Saleae Logic.app/Contents/MacOS/Logic`，传 `.app` 包路径会 `PermissionError`。
- **分析器名**：`"I2C"`，**大小写敏感**。小写 `"i2c"` 报 `Analyzer "i2c" not found`。
- **I2C 分析器设置键**：`SCL`、`SDA`，值必须是 **int** 通道号。传字符串报 `expected integer`。目标通道必须已在抓包中启用，否则报 `channel "N" is not enabled`。
- **时间单位统一为秒**（float）。`start_time`、`duration` 均为秒。
- **数值导出必须用 `DataTableExportConfiguration(handle, RadixType.HEXADECIMAL)`**。枚举名是 `HEXADECIMAL`（不是 `HEX`）。默认 radix 会把字节按 **Unicode 码点**写成字符（`0xFF` → U+00FF → UTF-8 `c3 bf`，`0x00` → NUL），是必须避开的陷阱。
- **不要给 `export_data_table` 传 `columns=`**。实测该参数会让 `type` / `start_time` / `duration` 三列整列消失。
- **数据表 CSV 列**：`name,type,start_time,duration,data,read,error,address,ack`。无解码结果时表头会**退化成只剩 `name,type,start_time,duration`**，读取必须容错，不能假设列固定。
- **每个 `.sal` 的启用通道不同**，必须逐抓包探测，禁止硬编码 SCL=0/SDA=1。实测：`lenovo开机时序.sal`→[0,1,2,3]，`友商.sal`→[0,1,2]，`hp008 palm.sal`→[5,6,7,8,9]。
- **ACK 未知时写 `null`**，不得默认成 `true`。
- **保真度**：`timing_fidelity == "decoded"` 时不得给出 `tSU;DAT` / `tHD;DAT` 这类 ns 级参数的确定结论。
- **不要吞异常**。参考反面样本：`i2c_hla/i2c_realtime.py` 里的裸 `except: pass`。

**实测结论（供实现参考，勿重新试错）**

| 项 | 结论 |
|---|---|
| Logic 2 版本 | 2.4.43，API 版本 1.0.0 |
| 真机 | Logic 16 已连接，`device_id=B4045E72363CE3C7` |
| 模拟设备 | `get_devices(include_simulation_devices=True)` 额外返回 LOGIC_16(`B4045E72363CE3C7`)、LOGIC_8(`F4243`)、LOGIC_PRO_8(`F4244`)、LOGIC_PRO_16(`F4241`) |
| `add_analyzer` 于已加载抓包 | 可用，返回有效 `AnalyzerHandle(analyzer_id=...)` |
| `export_data_table` | `analyzers` 是必需位置参数，只接受 `AnalyzerHandle` 或 `DataTableExportConfiguration` |
| `export_raw_data_csv` | 需目标通道已启用，否则 `InvalidRequestError` |
| 导出性能 | 51 万行抓包导出耗时数分钟，需进度提示与行数上限保护 |
| 完整分析器名单 | 可由 `add_analyzer("__bogus__")` 的报错文本取得 |

---

## 文件结构

开发位置与安装位置分离：源码放在本仓库（可版本控制、可 review），通过符号链接暴露给 Claude Code。

```
saleae-logic-proc/skills/saleae-i2c-debug/     # 源码（入 git）
├── SKILL.md
├── scripts/
│   ├── i2c_profile.py
│   ├── i2c_ingest.py
│   ├── i2c_analyze.py
│   ├── i2c_capture.py
│   ├── i2c_live.py
│   └── i2c_map.py
├── references/
│   ├── timing-specs.md
│   ├── saleae-api.md
│   └── source-mapping.md
├── assets/
│   └── i2c-profile.example.toml
└── tests/
    ├── conftest.py
    ├── fixtures/
    │   ├── sample_data_table.csv
    │   └── sample_udp.jsonl
    ├── test_profile.py
    ├── test_ingest.py
    ├── test_analyze.py
    ├── test_capture.py
    └── test_map.py

~/.claude/skills/saleae-i2c-debug -> 上述目录的符号链接
```

职责边界：

- `i2c_profile.py` — 只负责 profile 的加载/校验/默认值，不碰数据。
- `i2c_ingest.py` — 只负责「任意来源 → 归一化 dict」，不做分析。
- `i2c_analyze.py` — 只吃归一化 dict，只吐 findings + stats，不碰 IO。
- `i2c_capture.py` — 只负责驱动 Logic 2 与通道探测，产出后交给 `i2c_ingest`。
- `i2c_live.py` — 只负责 UDP 收包与增量归一化。
- `i2c_map.py` — 只负责源码检索与打分。

---

### Task 1: Skill 骨架与 Profile 加载

**Files:**
- Create: `skills/saleae-i2c-debug/scripts/i2c_profile.py`
- Create: `skills/saleae-i2c-debug/assets/i2c-profile.example.toml`
- Create: `skills/saleae-i2c-debug/tests/conftest.py`
- Create: `skills/saleae-i2c-debug/tests/test_profile.py`
- Create: `skills/saleae-i2c-debug/tests/fixtures/`（空目录占位）

**Interfaces:**
- Consumes: 无
- Produces:
  - `@dataclass Profile(name: str, bus_mode: str, scl_channel: int|None, sda_channel: int|None, addresses: list[int], clock_stretch_max: float|None, protocol_kind: str, registers: dict[int, dict])`
  - `load_profile(path: str|Path|None) -> Profile`
  - `default_profile() -> Profile`
  - `BUS_MODE_LIMITS: dict[str, dict[str, float]]`
  - `validate_profile(p: Profile) -> list[str]`（返回问题列表，空表示合法）

- [ ] **Step 1: 写失败的测试**

`tests/conftest.py`：
```python
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

FIXTURES = Path(__file__).parent / "fixtures"
```

`tests/test_profile.py`：
```python
import pytest
from i2c_profile import (Profile, load_profile, default_profile,
                         validate_profile, BUS_MODE_LIMITS)


def test_default_profile_is_raw_without_addresses():
    p = default_profile()
    assert p.protocol_kind == "raw"
    assert p.addresses == []
    assert p.bus_mode == "fast"


def test_load_toml_profile(tmp_path):
    cfg = tmp_path / "p.toml"
    cfg.write_text(
        'name = "touchpad"\n'
        'bus_mode = "fast"\n'
        "scl_channel = 0\n"
        "sda_channel = 1\n"
        "addresses = [0x2C, 0x15, 0x5D]\n"
        "\n"
        "[protocol]\n"
        'kind = "hid-over-i2c"\n'
        "\n"
        "[registers]\n"
        '"0x0001" = { name = "HID_DESCRIPTOR", len = 30 }\n'
    )
    p = load_profile(cfg)
    assert p.name == "touchpad"
    assert p.scl_channel == 0 and p.sda_channel == 1
    assert p.addresses == [0x2C, 0x15, 0x5D]
    assert p.protocol_kind == "hid-over-i2c"
    assert p.registers[0x0001]["name"] == "HID_DESCRIPTOR"
    assert p.registers[0x0001]["len"] == 30


def test_load_profile_none_returns_default():
    assert load_profile(None).protocol_kind == "raw"


def test_validate_rejects_unknown_bus_mode(tmp_path):
    cfg = tmp_path / "bad.toml"
    cfg.write_text('name = "x"\nbus_mode = "turbo"\n')
    p = load_profile(cfg)
    problems = validate_profile(p)
    assert any("bus_mode" in m for m in problems)


def test_validate_flags_missing_single_channel(tmp_path):
    cfg = tmp_path / "half.toml"
    cfg.write_text('name = "x"\nscl_channel = 0\n')
    problems = validate_profile(load_profile(cfg))
    assert any("sda_channel" in m for m in problems)


def test_bus_mode_limits_cover_all_modes():
    for mode in ("standard", "fast", "fast-plus", "high-speed"):
        assert mode in BUS_MODE_LIMITS
        assert "tLOW_min" in BUS_MODE_LIMITS[mode]
        assert "tHIGH_min" in BUS_MODE_LIMITS[mode]
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_profile.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'i2c_profile'`

- [ ] **Step 3: 实现 `i2c_profile.py`**

```python
"""I2C profile: device-specific config kept out of the generic analysis engine."""
from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Union

# I2C-bus specification timing minima, in seconds.
# Sources: NXP UM10204 (I2C-bus specification and user manual), Table 10.
BUS_MODE_LIMITS: dict[str, dict[str, float]] = {
    "standard": {
        "tLOW_min": 4.7e-6, "tHIGH_min": 4.0e-6, "tSU_DAT_min": 250e-9,
        "tHD_DAT_min": 0.0, "tSU_STA_min": 4.7e-6, "tHD_STA_min": 4.0e-6,
        "tSU_STO_min": 4.0e-6, "tBUF_min": 4.7e-6, "fmax": 100e3,
    },
    "fast": {
        "tLOW_min": 1.3e-6, "tHIGH_min": 0.6e-6, "tSU_DAT_min": 100e-9,
        "tHD_DAT_min": 0.0, "tSU_STA_min": 0.6e-6, "tHD_STA_min": 0.6e-6,
        "tSU_STO_min": 0.6e-6, "tBUF_min": 1.3e-6, "fmax": 400e3,
    },
    "fast-plus": {
        "tLOW_min": 0.5e-6, "tHIGH_min": 0.26e-6, "tSU_DAT_min": 50e-9,
        "tHD_DAT_min": 0.0, "tSU_STA_min": 0.26e-6, "tHD_STA_min": 0.26e-6,
        "tSU_STO_min": 0.26e-6, "tBUF_min": 0.5e-6, "fmax": 1000e3,
    },
    "high-speed": {
        "tLOW_min": 160e-9, "tHIGH_min": 60e-9, "tSU_DAT_min": 10e-9,
        "tHD_DAT_min": 0.0, "tSU_STA_min": 160e-9, "tHD_STA_min": 160e-9,
        "tSU_STO_min": 160e-9, "tBUF_min": 160e-9, "fmax": 3400e3,
    },
}


@dataclass
class Profile:
    name: str = "generic"
    bus_mode: str = "fast"
    scl_channel: Optional[int] = None
    sda_channel: Optional[int] = None
    addresses: list[int] = field(default_factory=list)
    clock_stretch_max: Optional[float] = None
    protocol_kind: str = "raw"
    registers: dict[int, dict] = field(default_factory=dict)

    def limits(self) -> dict[str, float]:
        limits = dict(BUS_MODE_LIMITS.get(self.bus_mode, BUS_MODE_LIMITS["fast"]))
        if self.clock_stretch_max is not None:
            limits["clock_stretch_max"] = self.clock_stretch_max
        return limits


def default_profile() -> Profile:
    return Profile()


def load_profile(path: Union[str, Path, None]) -> Profile:
    if path is None:
        return default_profile()
    raw = tomllib.loads(Path(path).read_text(encoding="utf-8"))

    protocol = raw.get("protocol", {}) or {}
    registers: dict[int, dict] = {}
    for key, spec in (raw.get("registers", {}) or {}).items():
        reg = int(key, 0) if isinstance(key, str) else int(key)
        registers[reg] = dict(spec)

    overrides = raw.get("timing_overrides", {}) or {}

    return Profile(
        name=raw.get("name", "generic"),
        bus_mode=raw.get("bus_mode", "fast"),
        scl_channel=raw.get("scl_channel"),
        sda_channel=raw.get("sda_channel"),
        addresses=[int(a) for a in raw.get("addresses", [])],
        clock_stretch_max=overrides.get("clock_stretch_max"),
        protocol_kind=protocol.get("kind", "raw"),
        registers=registers,
    )


def validate_profile(p: Profile) -> list[str]:
    problems: list[str] = []
    if p.bus_mode not in BUS_MODE_LIMITS:
        problems.append(
            f"unknown bus_mode {p.bus_mode!r}; expected one of {sorted(BUS_MODE_LIMITS)}"
        )
    if (p.scl_channel is None) != (p.sda_channel is None):
        problems.append("scl_channel and sda_channel must be set together or both unset")
    if p.scl_channel is not None and p.scl_channel == p.sda_channel:
        problems.append("scl_channel and sda_channel must differ")
    for a in p.addresses:
        if not 0 <= a <= 0x7F:
            problems.append(f"address {a:#x} out of 7-bit range")
    if p.protocol_kind not in ("raw", "hid-over-i2c"):
        problems.append(f"unknown protocol kind {p.protocol_kind!r}")
    return problems
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_profile.py -v`
Expected: 6 passed

- [ ] **Step 5: 写示例 profile**

`assets/i2c-profile.example.toml`：
```toml
# 示例 profile：触摸板 HID-over-I2C
# 核心分析引擎不知道任何设备协议，设备相关的全在这里。
name = "touchpad"
bus_mode = "fast"
scl_channel = 0
sda_channel = 1
addresses = [0x2C, 0x15, 0x5D]

[timing_overrides]
clock_stretch_max = 1.0e-3

[protocol]
kind = "hid-over-i2c"

[registers]
"0x0001" = { name = "HID_DESCRIPTOR", len = 30 }
"0x0002" = { name = "REPORT_DESCRIPTOR" }
```

- [ ] **Step 6: 提交**

```bash
git add skills/saleae-i2c-debug
git commit -m "feat(skill): I2C profile 加载与校验"
```

---

### Task 2: 离线归一化入口 `i2c_ingest.py`

**Files:**
- Create: `skills/saleae-i2c-debug/scripts/i2c_ingest.py`
- Create: `skills/saleae-i2c-debug/tests/fixtures/sample_data_table.csv`
- Create: `skills/saleae-i2c-debug/tests/test_ingest.py`

**Interfaces:**
- Consumes: `i2c_profile.Profile`
- Produces:
  - `parse_data_table_csv(path: str) -> list[dict]`（容错读取，列缺失时补空串）
  - `rows_to_transactions(rows: list[dict], *, scl: int|None, sda: int|None) -> list[dict]`
  - `normalize(rows_or_transactions, *, source: str, meta: dict) -> dict`（产出归一化文档）
  - `ingest_csv(path: str, *, source: str = "csv", scl=None, sda=None, profile=None) -> dict`
  - `write_normalized(doc: dict, out_path: str) -> None`
  - `sniff_format(path: str) -> str` → `"normalized_json"` | `"udp_jsonl"` | `"data_table_csv"`

- [ ] **Step 1: 造固定测试夹具**

`tests/fixtures/sample_data_table.csv` —— 手工构造，覆盖 ACK / NACK / 重复起始位 / 短 `tLOW`：

```csv
name,type,start_time,duration,"data","read","error","address","ack"
"t","start",0.001000,0.0000001,,,,,
"t","address",0.001100,0.000022,,false,,"0x2C",true
"t","data",0.001122,0.000022,"0x01",,,,true
"t","data",0.001144,0.000022,"0x20",,,,true
"t","stop",0.001166,0.0000001,,,,,
"t","start",0.002000,0.0000001,,,,,
"t","address",0.002100,0.000022,,false,,"0x2C",true
"t","data",0.002122,0.000022,"0x02",,,,true
"t","start",0.002144,0.0000001,,,,,
"t","address",0.002244,0.000022,,true,,"0x2C",true
"t","data",0.002266,0.000022,"0x00",,,,true
"t","data",0.002288,0.000022,"0x00",,,,false
"t","stop",0.002300,0.0000001,,,,,
"t","start",0.003000,0.0000001,,,,,
"t","address",0.003100,0.000022,,false,,"0x2E",false
"t","stop",0.003122,0.0000001,,,,,
```

- [ ] **Step 2: 写失败的测试**

`tests/test_ingest.py`：
```python
import json
import pytest
from i2c_ingest import (parse_data_table_csv, rows_to_transactions, normalize,
                        ingest_csv, write_normalized, sniff_format)

CSV = str(__import__("pathlib").Path(__file__).parent / "fixtures" / "sample_data_table.csv")


def test_parse_csv_handles_full_schema():
    rows = parse_data_table_csv(CSV)
    assert len(rows) == 16
    assert rows[0]["type"] == "start"
    assert rows[1]["address"] == "0x2C"


def test_parse_csv_tolerates_degenerate_header(tmp_path):
    """Saleae 在无解码结果时只写 4 列，读取不得崩。"""
    p = tmp_path / "empty.csv"
    p.write_text("name,type,start_time,duration\n")
    assert parse_data_table_csv(str(p)) == []


def test_rows_to_transactions_splits_on_start_stop():
    txs = rows_to_transactions(parse_data_table_csv(CSV), scl=None, sda=None)
    assert len(txs) == 4
    assert txs[0]["addr"] == 0x2C and txs[0]["rw"] == "W"
    assert txs[0]["bytes"] == [0x01, 0x20]


def test_transaction_records_per_event_timestamps():
    tx = rows_to_transactions(parse_data_table_csv(CSV), scl=None, sda=None)[0]
    types = [e["type"] for e in tx["events"]]
    assert types == ["start", "address", "data", "data", "stop"]
    assert tx["events"][1]["t"] == pytest.approx(0.001100)


def test_nack_is_recorded_not_defaulted_to_true():
    txs = rows_to_transactions(parse_data_table_csv(CSV), scl=None, sda=None)
    assert txs[0]["events"][2]["ack"] is True
    assert txs[2]["events"][3]["ack"] is False        # 第 3 个事务末字节 NACK
    assert txs[3]["events"][1]["ack"] is False        # 地址 NACK


def test_repeated_start_detected():
    txs = rows_to_transactions(parse_data_table_csv(CSV), scl=None, sda=None)
    assert txs[1]["repeated_start"] is False
    assert txs[1]["followed_by_restart"] is True      # 事务 1 后直接 START


def test_read_address_sets_rw():
    txs = rows_to_transactions(parse_data_table_csv(CSV), scl=None, sda=None)
    assert txs[2]["rw"] == "R"


def test_normalize_document_shape():
    doc = normalize(rows_to_transactions(parse_data_table_csv(CSV), scl=None, sda=None),
                    source="csv", meta={"scl_channel": 1, "sda_channel": 2})
    assert doc["version"] == 1
    assert doc["source"] == "csv"
    assert doc["meta"]["timing_fidelity"] == "decoded"
    assert len(doc["transactions"]) == 4


def test_ingest_csv_roundtrip(tmp_path):
    doc = ingest_csv(CSV, scl=1, sda=2)
    out = tmp_path / "tx.json"
    write_normalized(doc, str(out))
    back = json.loads(out.read_text())
    assert back == doc


def test_sniff_format(tmp_path):
    j = tmp_path / "a.json"
    j.write_text('{"version": 1}')
    assert sniff_format(str(j)) == "normalized_json"
    l = tmp_path / "a.jsonl"
    l.write_text('{"type":"START"}\n')
    assert sniff_format(str(l)) == "udp_jsonl"
    assert sniff_format(CSV) == "data_table_csv"
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_ingest.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'i2c_ingest'`

- [ ] **Step 4: 实现 `i2c_ingest.py`**

```python
"""Normalize any I2C data source into the shared transactions.json document."""
from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any, Iterable, Optional

FULL_COLUMNS = ["name", "type", "start_time", "duration",
                "data", "read", "error", "address", "ack"]


def parse_data_table_csv(path: str) -> list[dict]:
    """Read a Saleae analyzer data-table export.

    The header degrades to a subset of columns when nothing decoded, so every
    field is fetched defensively rather than with row["x"].
    """
    with open(path, newline="", encoding="utf-8", errors="replace") as fh:
        reader = csv.DictReader(fh)
        out = []
        for row in reader:
            out.append({c: (row.get(c) or "") for c in FULL_COLUMNS})
        return out


def _hex_or_none(value: str) -> Optional[int]:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return int(value, 16)
    except ValueError:
        return None


def _ack_or_none(value: str) -> Optional[bool]:
    value = (value or "").strip().lower()
    if value == "true":
        return True
    if value == "false":
        return False
    return None   # unknown stays unknown; never default to True


def rows_to_transactions(rows: list[dict], *, scl: Optional[int],
                         sda: Optional[int]) -> list[dict]:
    transactions: list[dict] = []
    current: Optional[dict] = None

    for row in rows:
        kind = (row.get("type") or "").strip()
        t = float(row.get("start_time") or 0.0)

        if kind == "start":
            # A START while a transaction is still open is a repeated start (Sr):
            # flush the open one first, otherwise it is silently swallowed.
            if current is not None:
                current["end_time"] = current["events"][-1]["t"]
                transactions.append(current)
            current = {"start_time": t, "events": [], "bytes": [], "addr": None, "rw": None}
            current["events"].append({"t": t, "type": "start"})
        elif kind == "stop":
            if current is None:
                continue
            current["events"].append({"t": t, "type": "stop"})
            current["end_time"] = t
            transactions.append(current)
            current = None
        elif kind == "address":
            if current is None:
                current = {"start_time": t, "events": [], "bytes": [], "addr": None, "rw": None}
            addr = _hex_or_none(row.get("address", ""))
            is_read = (row.get("read") or "").strip().lower() == "true"
            current["addr"] = addr
            current["rw"] = "R" if is_read else "W"
            current["events"].append(
                {"t": t, "type": "address", "ack": _ack_or_none(row.get("ack", "")),
                 "value": addr, "read": is_read})
        elif kind == "data":
            if current is None:
                current = {"start_time": t, "events": [], "bytes": [], "addr": None, "rw": None}
            value = _hex_or_none(row.get("data", ""))
            current["bytes"].append(value)
            current["events"].append(
                {"t": t, "type": "data", "value": value,
                 "ack": _ack_or_none(row.get("ack", ""))})

    if current is not None:               # capture ended without a STOP
        transactions.append(current)

    for i, tx in enumerate(transactions):
        tx["index"] = i
        tx.setdefault("end_time", tx["events"][-1]["t"] if tx["events"] else tx["start_time"])
        ends_with_stop = any(e["type"] == "stop" for e in tx["events"])
        has_next = i + 1 < len(transactions)
        # Sr 收尾：本事务没有 STOP，且后面还有事务。
        tx["followed_by_restart"] = bool(has_next and not ends_with_stop)
        # 由 Sr 引出：上一个事务没有以 STOP 收尾。
        tx["repeated_start"] = bool(
            i > 0 and transactions[i - 1]["followed_by_restart"])
        tx["flags"] = []
    return transactions


def normalize(transactions: list[dict], *, source: str, meta: dict) -> dict:
    meta = dict(meta)
    meta.setdefault("timing_fidelity", "decoded")
    return {
        "version": 1,
        "source": source,
        "captured_at": meta.pop("captured_at", None),
        "meta": meta,
        "transactions": transactions,
    }


def ingest_csv(path: str, *, source: str = "csv", scl: Optional[int] = None,
               sda: Optional[int] = None, profile=None) -> dict:
    meta: dict[str, Any] = {
        "scl_channel": scl, "sda_channel": sda,
        "profile": getattr(profile, "name", None),
        "source_file": str(path),
        "timing_fidelity": "decoded",
    }
    rows = parse_data_table_csv(path)
    return normalize(rows_to_transactions(rows, scl=scl, sda=sda), source=source, meta=meta)


def write_normalized(doc: dict, out_path: str) -> None:
    Path(out_path).write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")


def sniff_format(path: str) -> str:
    p = Path(path)
    if p.suffix == ".jsonl":
        return "udp_jsonl"
    if p.suffix == ".json":
        return "normalized_json"
    with open(p, encoding="utf-8", errors="replace") as fh:
        head = fh.readline()
    if head.startswith("name,type,start_time"):
        return "data_table_csv"
    if head.lstrip().startswith("{"):
        return "udp_jsonl"
    raise ValueError(f"unrecognized I2C data format: {path}")
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_ingest.py -v`
Expected: 10 passed

- [ ] **Step 6: 对真实抓包做冒烟验证**

先按 Task 4 的方式导出真实 CSV，或直接用下面命令验证容错路径：

Run: `cd skills/saleae-i2c-debug && python3 -c "
import sys; sys.path.insert(0,'scripts')
from i2c_ingest import ingest_csv, write_normalized
doc = ingest_csv('/tmp/clean_hex.csv', scl=1, sda=2)
print('transactions:', len(doc['transactions']))
print('first:', doc['transactions'][0])
"`
Expected: 打印出事务数量与首条事务结构，不抛异常

- [ ] **Step 7: 提交**

```bash
git add skills/saleae-i2c-debug
git commit -m "feat(skill): 离线 I2C 数据归一化（CSV → transactions.json）"
```

---

### Task 3: 分析引擎 `i2c_analyze.py`

**Files:**
- Create: `skills/saleae-i2c-debug/scripts/i2c_analyze.py`
- Create: `skills/saleae-i2c-debug/tests/test_analyze.py`

**Interfaces:**
- Consumes: `i2c_profile.Profile`、归一化文档（Task 2 产出）
- Produces:
  - `analyze(doc: dict, *, profile: Profile) -> dict` → `{"findings": [...], "stats": {...}, "timing": {...}}`
  - `Finding = dict(code, severity, tx_index, t, detail)`；severity ∈ `error|warn|info`
  - `render_markdown(result: dict, doc: dict, profile: Profile) -> str`
  - `main(argv) -> int`（`python3 i2c_analyze.py <transactions.json> -o report.md [--profile p.toml] [--bus-mode fast]`）

- [ ] **Step 1: 写失败的测试**

`tests/test_analyze.py`：
```python
import pytest
from i2c_profile import Profile
from i2c_ingest import rows_to_transactions, normalize, parse_data_table_csv
from i2c_analyze import analyze, render_markdown

import pathlib
CSV = str(pathlib.Path(__file__).parent / "fixtures" / "sample_data_table.csv")


@pytest.fixture
def doc():
    return normalize(rows_to_transactions(parse_data_table_csv(CSV), scl=1, sda=2),
                     source="csv", meta={"scl_channel": 1, "sda_channel": 2})


def codes(result):
    return [f["code"] for f in result["findings"]]


def test_detects_data_nack(doc):
    assert "DATA_NACK" in codes(analyze(doc, profile=Profile()))


def test_detects_address_nack(doc):
    assert "ADDR_NACK" in codes(analyze(doc, profile=Profile()))


def test_proper_repeated_start_is_not_flagged(doc):
    """夹具里 W 0x2C -> Sr -> R 0x2C 是正确写法，不得误报。"""
    assert "MISSING_RESTART" not in codes(analyze(doc, profile=Profile()))


def test_detects_missing_restart(tmp_path):
    """写后读同一地址却用 STOP+START，应报 MISSING_RESTART。"""
    from i2c_ingest import ingest_csv
    p = tmp_path / "nostart.csv"
    p.write_text('name,type,start_time,duration,"data","read","error","address","ack"\n'
                 '"t","start",0.001,0.0,,,,,\n'
                 '"t","address",0.002,0.0,,false,,"0x2C",true\n'
                 '"t","data",0.003,0.0,"0x01",,,,true\n'
                 '"t","stop",0.004,0.0,,,,,\n'
                 '"t","start",0.005,0.0,,,,,\n'
                 '"t","address",0.006,0.0,,true,,"0x2C",true\n'
                 '"t","data",0.007,0.0,"0x00",,,,true\n'
                 '"t","stop",0.008,0.0,,,,,\n')
    result = analyze(ingest_csv(str(p)), profile=Profile())
    assert "MISSING_RESTART" in [f["code"] for f in result["findings"]]


def test_findings_carry_transaction_index(doc):
    nack = [f for f in analyze(doc, profile=Profile())["findings"] if f["code"] == "DATA_NACK"]
    assert nack and nack[0]["tx_index"] == 2


def test_stats_counts(doc):
    stats = analyze(doc, profile=Profile())["stats"]
    assert stats["transaction_count"] == 4
    assert stats["read_count"] == 1
    assert stats["write_count"] == 3
    assert stats["addresses"]["0x2C"] == 3


def test_decoded_fidelity_suppresses_ns_level_claims(doc):
    """decoded 模式下不得给出 tSU;DAT / tHD;DAT 的确定结论。"""
    result = analyze(doc, profile=Profile())
    assert result["timing"]["tSU_DAT"]["reliable"] is False
    assert result["timing"]["tSU_DAT"]["min"] is None


def test_timing_computes_transaction_duration(doc):
    # tx0 0.001000→0.001166 (166µs) 最长；tx3 0.003000→0.003122 (122µs) 最短
    dur = analyze(doc, profile=Profile())["timing"]["tx_duration"]
    assert dur["max"] == pytest.approx(0.000166, abs=1e-6)
    assert dur["min"] == pytest.approx(0.000122, abs=1e-6)


def test_markdown_renders_findings_and_stats(doc):
    md = render_markdown(analyze(doc, profile=Profile()), doc, Profile())
    assert "DATA_NACK" in md
    assert "0x2C" in md
    assert "保真度" in md


def test_no_stop_flagged(tmp_path):
    from i2c_ingest import ingest_csv
    p = tmp_path / "nostop.csv"
    p.write_text('name,type,start_time,duration,"data","read","error","address","ack"\n'
                 '"t","start",0.001,0.0,,,,,\n'
                 '"t","address",0.002,0.0,,false,,"0x2C",true\n'
                 '"t","data",0.003,0.0,"0x01",,,,true\n')
    result = analyze(ingest_csv(str(p)), profile=Profile())
    assert "NO_STOP" in [f["code"] for f in result["findings"]]
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_analyze.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'i2c_analyze'`

- [ ] **Step 3: 实现 `i2c_analyze.py`**

```python
"""I2C protocol and timing analysis over a normalized transactions document."""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from typing import Any, Optional

from i2c_profile import Profile, load_profile, validate_profile


def _finding(code: str, severity: str, tx_index: Optional[int], t: Optional[float],
             detail: str) -> dict:
    return {"code": code, "severity": severity, "tx_index": tx_index, "t": t, "detail": detail}


def _events(tx: dict) -> list[dict]:
    return tx.get("events", [])


def _edge_gaps(tx: dict) -> list[float]:
    """Deltas between consecutive events. Only meaningful for decoded data."""
    ts = [e["t"] for e in _events(tx)]
    return [b - a for a, b in zip(ts, ts[1:])]


def _check_protocol(txs: list[dict], profile: Profile, findings: list[dict]) -> None:
    addressed = set(profile.addresses) if profile.addresses else None

    for tx in txs:
        idx = tx.get("index")
        evs = _events(tx)

        addr_ev = next((e for e in evs if e["type"] == "address"), None)
        if addr_ev is not None and addr_ev.get("ack") is False:
            findings.append(_finding("ADDR_NACK", "error", idx, addr_ev["t"],
                                     f"地址 {tx.get('addr') and hex(tx['addr'])} 未被应答"))

        for e in evs:
            if e["type"] == "data" and e.get("ack") is False:
                findings.append(_finding("DATA_NACK", "error", idx, e["t"],
                                         f"数据字节 {e.get('value') and hex(e['value'])} 未被应答"))

        if not any(e["type"] == "stop" for e in evs) and not tx.get("followed_by_restart"):
            last = evs[-1]["t"] if evs else tx.get("start_time")
            findings.append(_finding("NO_STOP", "error", idx, last, "事务结束仍无 STOP"))

        if sum(1 for e in evs if e["type"] == "start") > 1:
            findings.append(_finding("UNEXPECTED_START", "error", idx,
                                     tx.get("start_time"), "事务中途出现 START"))

        if addressed is not None and tx.get("addr") is not None and tx["addr"] not in addressed:
            findings.append(_finding("UNKNOWN_ADDRESS", "warn", idx, tx.get("start_time"),
                                     f"地址 {hex(tx['addr'])} 不在 profile 声明的设备列表中"))

    # 写后读同一地址却用了 STOP+START，而非重复起始位
    for a, b in zip(txs, txs[1:]):
        if (a.get("rw") == "W" and b.get("rw") == "R"
                and a.get("addr") is not None and a.get("addr") == b.get("addr")
                and not a.get("followed_by_restart")):
            findings.append(_finding("MISSING_RESTART", "warn", b.get("index"),
                                     b.get("start_time"),
                                     "写后读同一地址经 STOP+START，建议改用重复起始位"))


def _check_timing(txs: list[dict], profile: Profile, findings: list[dict]) -> dict:
    limits = profile.limits()
    durations = [tx["end_time"] - tx["start_time"] for tx in txs
                 if tx.get("end_time") is not None]
    gaps = [b["start_time"] - a["end_time"] for a, b in zip(txs, txs[1:])
            if a.get("end_time") is not None]

    timing: dict[str, Any] = {
        "tx_duration": {
            "min": min(durations) if durations else None,
            "max": max(durations) if durations else None,
            "mean": statistics.fmean(durations) if durations else None,
            "reliable": True,
        },
        "tBUF": {
            "min": min(gaps) if gaps else None,
            "limit": limits.get("tBUF_min"),
            "reliable": True,
        },
        # 逐字节建立/保持时间需要原始边沿数据，decoded 模式下不可信。
        "tSU_DAT": {"min": None, "limit": limits.get("tSU_DAT_min"), "reliable": False},
        "tHD_DAT": {"min": None, "limit": limits.get("tHD_DAT_min"), "reliable": False},
        "tLOW": {"min": None, "limit": limits.get("tLOW_min"), "reliable": False},
        "tHIGH": {"min": None, "limit": limits.get("tHIGH_min"), "reliable": False},
    }

    if gaps and limits.get("tBUF_min") is not None and min(gaps) < limits["tBUF_min"]:
        findings.append(_finding("IDLE_TOO_SHORT", "warn", None, None,
                                 f"事务间隔 {min(gaps):.2e}s 小于 tBUF {limits['tBUF_min']:.2e}s"))
    return timing


def _cosine_similarity(a: str, b: str) -> float:
    from collections import Counter
    import math
    ca, cb = Counter(a), Counter(b)
    if not ca or not cb:
        return 0.0
    dot = sum(ca[c] * cb.get(c, 0) for c in ca)
    na = math.sqrt(sum(v * v for v in ca.values()))
    nb = math.sqrt(sum(v * v for v in cb.values()))
    return dot / (na * nb) if na and nb else 0.0


def _cluster_timestamps(times: list[float], window: float = 0.5) -> list[dict]:
    if not times:
        return []
    times = sorted(times)
    clusters, start, prev = [], times[0], times[0]
    for t in times[1:]:
        if t - prev > window:
            clusters.append((start, prev))
            start = t
        prev = t
    clusters.append((start, prev))
    return [{"start": a, "end": b, "count": sum(1 for t in times if a <= t <= b)}
            for a, b in clusters]


def _build_stats(txs: list[dict], findings: list[dict]) -> dict:
    addr_counts: dict[str, int] = {}
    byte_counts: list[int] = []
    for tx in txs:
        a = tx.get("addr")
        if a is not None:
            key = hex(a)
            addr_counts[key] = addr_counts.get(key, 0) + 1
        byte_counts.append(len(tx.get("bytes", [])))

    span = 0.0
    if txs:
        span = txs[-1].get("end_time", 0.0) - txs[0].get("start_time", 0.0)

    err_times = [f["t"] for f in findings if f["severity"] == "error" and f["t"] is not None]

    return {
        "transaction_count": len(txs),
        "read_count": sum(1 for tx in txs if tx.get("rw") == "R"),
        "write_count": sum(1 for tx in txs if tx.get("rw") == "W"),
        "addresses": addr_counts,
        "bytes_per_tx": {
            "min": min(byte_counts) if byte_counts else None,
            "max": max(byte_counts) if byte_counts else None,
            "mean": statistics.fmean(byte_counts) if byte_counts else None,
        },
        "span_seconds": span,
        "tx_rate_hz": (len(txs) / span) if span > 0 else None,
        "error_clusters": _cluster_timestamps(err_times),
    }


def analyze(doc: dict, *, profile: Profile) -> dict:
    txs = doc.get("transactions", [])
    findings: list[dict] = []
    _check_protocol(txs, profile, findings)
    timing = _check_timing(txs, profile, findings)
    findings.sort(key=lambda f: (f["tx_index"] if f["tx_index"] is not None else -1))
    return {"findings": findings, "timing": timing, "stats": _build_stats(txs, findings)}


def render_markdown(result: dict, doc: dict, profile: Profile) -> str:
    meta = doc.get("meta", {})
    fidelity = meta.get("timing_fidelity", "decoded")
    lines = [
        "# I2C 分析报告", "",
        f"- 来源：`{meta.get('source_file', doc.get('source', '?'))}`",
        f"- 通道：SCL={meta.get('scl_channel')} SDA={meta.get('sda_channel')}",
        f"- 总线模式：{profile.bus_mode}",
        f"- 保真度：`{fidelity}`"
        + ("（时间戳来自解码器，ns 级时序参数不可信）" if fidelity == "decoded" else ""),
        "", "## 统计", "",
    ]
    s = result["stats"]
    lines += [
        f"- 事务数：{s['transaction_count']}（读 {s['read_count']} / 写 {s['write_count']}）",
        f"- 地址分布：{s['addresses'] or '—'}",
        f"- 每事务字节数：min={s['bytes_per_tx']['min']} max={s['bytes_per_tx']['max']}",
        f"- 时间跨度：{s['span_seconds']:.6f}s，速率 {s['tx_rate_hz'] and round(s['tx_rate_hz'], 2)} Hz",
        "", "## 时序", "",
        "| 参数 | min | 限值 | 可信 |", "|---|---|---|---|",
    ]
    for name, t in result["timing"].items():
        min_s = "—" if t["min"] is None else f"{t['min']:.3e}s"
        lim = t.get("limit")
        lim_s = "—" if not lim else f"{lim:.3e}s"
        reliable_s = "是" if t["reliable"] else "否（需原始边沿）"
        lines.append(f"| {name} | {min_s} | {lim_s} | {reliable_s} |")

    lines += ["", "## 违规", ""]
    if not result["findings"]:
        lines.append("未发现违规。")
    else:
        lines += ["| 严重度 | 代码 | 事务 | 时间(s) | 说明 |", "|---|---|---|---|---|"]
        for f in result["findings"]:
            lines.append(f"| {f['severity']} | {f['code']} | {f['tx_index']} "
                         f"| {f['t'] and round(f['t'], 6)} | {f['detail']} |")

    if s["error_clusters"]:
        lines += ["", "## 错误时间聚类", ""]
        for c in s["error_clusters"]:
            lines.append(f"- {c['start']:.6f}s – {c['end']:.6f}s：{c['count']} 条")

    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Analyze a normalized I2C transactions document")
    ap.add_argument("input")
    ap.add_argument("-o", "--output", default="report.md")
    ap.add_argument("--profile")
    ap.add_argument("--bus-mode", choices=["standard", "fast", "fast-plus", "high-speed"])
    ap.add_argument("--json-output")
    args = ap.parse_args(argv)

    profile = load_profile(args.profile)
    if args.bus_mode:
        profile.bus_mode = args.bus_mode
    problems = validate_profile(profile)
    if problems:
        for p in problems:
            print(f"profile 问题: {p}", file=sys.stderr)
        return 2

    doc = json.loads(open(args.input, encoding="utf-8").read())
    result = analyze(doc, profile=profile)
    open(args.output, "w", encoding="utf-8").write(render_markdown(result, doc, profile))
    if args.json_output:
        open(args.json_output, "w", encoding="utf-8").write(json.dumps(result, indent=2))
    print(f"报告已写入 {args.output}；发现 {len(result['findings'])} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_analyze.py -v`
Expected: 10 passed

- [ ] **Step 5: 对真实抓包生成第一份报告**

Run: `cd skills/saleae-i2c-debug && python3 scripts/i2c_ingest.py /tmp/clean_hex.csv -o /tmp/real.json --scl 1 --sda 2 && python3 scripts/i2c_analyze.py /tmp/real.json -o /tmp/real_report.md`
Expected: 生成报告。人工检查 `0xFF` 连发、全 NACK 的段落是否被正确标为异常（该抓包的通道组合很可能选错了，报告出现大量 DATA_NACK 属于**正确**行为）

- [ ] **Step 6: 提交**

```bash
git add skills/saleae-i2c-debug
git commit -m "feat(skill): I2C 协议与时序分析引擎"
```

---

### Task 4: 采集入口 `i2c_capture.py`（含通道自动探测）

**Files:**
- Create: `skills/saleae-i2c-debug/scripts/i2c_capture.py`
- Create: `skills/saleae-i2c-debug/tests/test_capture.py`

**Interfaces:**
- Consumes: `i2c_ingest.normalize`
- Produces:
  - `clean_env() -> dict`（剥离 `ELECTRON_RUN_AS_NODE` 的 env 副本）
  - `launch_or_connect(app_path: str|None, port: int) -> Manager`
  - `enabled_channels(cap) -> list[int]`
  - `score_decode(rows: list[dict]) -> float`
  - `discover_scl_sda(cap, channels: list[int], addresses: list[int]|None) -> tuple[int, int, list[dict]]`
  - `run_capture(...) -> dict`（返回归一化文档）
  - `main(argv) -> int`

**关于打分函数的设计依据**：实测「按解码行数」打分**会选错**——`lenovo开机时序.sal` 在 SCL=1/SDA=2 下解出 12 万行却全是 `0xFF` + 全 NACK，是噪声。真总线特征是**地址种类少 + ACK 比例高 + 错误少**。

- [ ] **Step 1: 写失败的测试**

`tests/test_capture.py`：
```python
import os
import pytest
from i2c_capture import clean_env, score_decode


def test_clean_env_removes_electron_run_as_node(monkeypatch):
    monkeypatch.setenv("ELECTRON_RUN_AS_NODE", "1")
    monkeypatch.setenv("PATH", "/usr/bin")
    env = clean_env()
    assert "ELECTRON_RUN_AS_NODE" not in env
    assert env["PATH"] == "/usr/bin"


def test_clean_env_does_not_mutate_os_environ(monkeypatch):
    monkeypatch.setenv("ELECTRON_RUN_AS_NODE", "1")
    clean_env()
    assert os.environ["ELECTRON_RUN_AS_NODE"] == "1"


def _row(t, addr=None, data=None, ack=None, err=""):
    return {"type": t, "address": addr or "", "data": data or "",
            "ack": "" if ack is None else ("true" if ack else "false"),
            "error": err, "start_time": "0", "duration": "0", "name": "x", "read": ""}


def test_score_rewards_consistent_addresses_and_acks():
    good = [_row("start")] + [_row("address", "0x2C", ack=True)] + \
           [_row("data", data="0x01", ack=True), _row("data", data="0x02", ack=True)] * 20
    assert score_decode(good) > 0


def test_score_punishes_all_nack_noise():
    """实测噪声形态：单一地址、海量 0xFF、全 NACK。"""
    noise = [_row("start")] + [_row("address", "0x00", ack=False)] + \
            [_row("data", data="0xFF", ack=False)] * 200
    assert score_decode(noise) < 0


def test_score_prefers_fewer_distinct_addresses():
    focused = [_row("address", "0x2C", ack=True)] * 50
    scattered = [_row("address", f"0x{i:02X}", ack=True) for i in range(50)]
    assert score_decode(focused) > score_decode(scattered)


def test_score_of_empty_is_zero():
    assert score_decode([]) == 0
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_capture.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'i2c_capture'`

- [ ] **Step 3: 实现 `i2c_capture.py`**

```python
"""Drive Saleae Logic 2 via the Automation API and normalize the result."""
from __future__ import annotations

import argparse
import itertools
import os
import sys
from typing import Optional

from saleae import automation
from saleae.automation import (CaptureConfiguration, DataTableExportConfiguration,
                               LogicDeviceConfiguration, RadixType, TimedCaptureMode,
                               DigitalTriggerCaptureMode, DigitalTriggerType,
                               ManualCaptureMode)

import i2c_ingest
from i2c_profile import load_profile

DEFAULT_APP = "/Applications/Saleae Logic.app/Contents/MacOS/Logic"


def clean_env() -> dict:
    """Return an env copy safe for launching Logic 2.

    Logic 2 is an Electron app. If ELECTRON_RUN_AS_NODE is set (Claude Code's
    shell sets it to 1), the Electron binary runs as plain Node, rejects
    --automation, and the automation server never starts.
    """
    env = dict(os.environ)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    return env


def launch_or_connect(app_path: Optional[str], port: int):
    import subprocess
    original_popen = subprocess.Popen

    def patched(*args, **kwargs):
        kwargs["env"] = clean_env()
        return original_popen(*args, **kwargs)

    subprocess.Popen = patched
    try:
        try:
            return automation.Manager.launch(application_path=app_path or DEFAULT_APP, port=port)
        except automation.Logic2AlreadyRunningError:
            return automation.Manager.connect(port=port)
    finally:
        subprocess.Popen = original_popen


def enabled_channels(cap, limit: int = 16) -> list[int]:
    """Probe which digital channels the capture actually has enabled."""
    import tempfile
    found = []
    with tempfile.TemporaryDirectory() as td:
        for ch in range(limit):
            try:
                cap.export_raw_data_csv(directory=os.path.join(td, str(ch)),
                                        digital_channels=[ch])
                found.append(ch)
            except Exception:
                pass
    return found


def _ack_ratio(rows: list[dict]) -> float:
    judged = [r for r in rows if r.get("ack") in ("true", "false")]
    if not judged:
        return 0.0
    return sum(1 for r in judged if r["ack"] == "true") / len(judged)


def score_decode(rows: list[dict]) -> float:
    """Score a decode for plausibility as real I2C traffic.

    Row count alone is misleading: a wrong SCL/SDA pairing can decode a noisy
    signal into hundreds of thousands of frames. Real traffic has few distinct
    addresses, mostly-ACKed transfers, and almost no protocol errors.
    """
    if not rows:
        return 0.0
    addresses = {r["address"] for r in rows if r.get("type") == "address" and r.get("address")}
    errors = sum(1 for r in rows if r.get("error"))
    frames = sum(1 for r in rows if r.get("type") in ("address", "data"))
    if frames == 0:
        return -1.0
    return (_ack_ratio(rows) * 100.0
            - len(addresses) * 5.0
            - (errors / frames) * 200.0
            + min(frames, 5000) / 1000.0)


def discover_scl_sda(cap, channels: list[int], addresses: Optional[list[int]] = None):
    """Brute-force channel pairs; return the best (scl, sda, ranked candidates)."""
    import csv
    import tempfile

    candidates = []
    with tempfile.TemporaryDirectory() as td:
        for scl, sda in itertools.permutations(channels, 2):
            try:
                handle = cap.add_analyzer("I2C", label=f"probe_{scl}_{sda}",
                                          settings={"SCL": scl, "SDA": sda})
                out = os.path.join(td, f"dec_{scl}_{sda}.csv")
                cap.export_data_table(
                    filepath=out,
                    analyzers=[DataTableExportConfiguration(handle, RadixType.HEXADECIMAL)])
                rows = i2c_ingest.parse_data_table_csv(out)
            except Exception as exc:
                candidates.append({"scl": scl, "sda": sda, "score": float("-inf"),
                                   "rows": 0, "error": f"{type(exc).__name__}: {exc}"})
                continue

            score = score_decode(rows)
            if addresses:
                seen = {r["address"] for r in rows
                        if r.get("type") == "address" and r.get("address")}
                wanted = {hex(a) for a in addresses}
                if seen & wanted:
                    score += 50.0
            candidates.append({"scl": scl, "sda": sda, "score": score, "rows": len(rows)})

    candidates.sort(key=lambda c: -c["score"])
    usable = [c for c in candidates if c["score"] > float("-inf")]
    if not usable:
        raise RuntimeError("没有可用的 SCL/SDA 组合；检查抓包是否包含 I2C 信号")
    best = usable[0]
    return best["scl"], best["sda"], candidates


def run_capture(*, output: str, duration: float, scl: Optional[int], sda: Optional[int],
                sample_rate: Optional[int], simulate: bool, app_path: Optional[str],
                port: int, addresses: Optional[list[int]], trigger_channel: Optional[int],
                profile_path: Optional[str]) -> dict:
    mgr = launch_or_connect(app_path, port)
    try:
        devices = mgr.get_devices(include_simulation_devices=simulate)
        if not devices:
            raise RuntimeError("未发现设备。请连接 Saleae 硬件，或加 --simulate 使用模拟设备。")
        device = devices[0]

        if scl is None or sda is None:
            # 通道未知时必须多开几个通道，否则后续探测无从下手。
            device_config = LogicDeviceConfiguration(
                enabled_digital_channels=list(range(8)),
                digital_sample_rate=sample_rate or 10_000_000)
        else:
            device_config = LogicDeviceConfiguration(
                enabled_digital_channels=sorted({scl, sda}),
                digital_sample_rate=sample_rate or 10_000_000)

        if trigger_channel is not None:
            mode = DigitalTriggerCaptureMode(
                trigger_type=DigitalTriggerType.RISING,
                trigger_channel_index=trigger_channel)
        else:
            mode = TimedCaptureMode(duration_seconds=duration)

        cap = mgr.start_capture(device_configuration=device_config,
                                device_id=device.device_id,
                                capture_configuration=CaptureConfiguration(capture_mode=mode))
        cap.wait()

        if scl is None or sda is None:
            channels = enabled_channels(cap)
            scl, sda, ranked = discover_scl_sda(cap, channels, addresses)
            print(f"自动探测通道：SCL={scl} SDA={sda}", file=sys.stderr)
            for c in ranked[:5]:
                print(f"  候选 SCL={c['scl']} SDA={c['sda']} "
                      f"score={c['score']:.2f} rows={c['rows']}", file=sys.stderr)

        handle = cap.add_analyzer("I2C", label="i2c-debug", settings={"SCL": scl, "SDA": sda})
        csv_path = os.path.splitext(output)[0] + ".csv"
        cap.export_data_table(
            filepath=csv_path,
            analyzers=[DataTableExportConfiguration(handle, RadixType.HEXADECIMAL)])
        if output.endswith(".sal"):
            cap.save_capture(output)
        cap.close()
    finally:
        mgr.close()

    profile = load_profile(profile_path)
    doc = i2c_ingest.ingest_csv(csv_path, source="automation", scl=scl, sda=sda,
                                profile=profile)
    doc["meta"]["timing_fidelity"] = "raw"
    doc["meta"]["digital_sample_rate"] = sample_rate or 10_000_000
    json_path = os.path.splitext(output)[0] + ".json"
    i2c_ingest.write_normalized(doc, json_path)
    return doc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Capture I2C with Saleae Logic 2")
    ap.add_argument("-o", "--output", default="capture.sal")
    ap.add_argument("--duration", type=float, default=3.0)
    ap.add_argument("--scl", type=int)
    ap.add_argument("--sda", type=int)
    ap.add_argument("--sample-rate", type=int, default=10_000_000)
    ap.add_argument("--simulate", action="store_true",
                    help="允许选用 Logic 2 模拟设备（无硬件时使用）")
    ap.add_argument("--app-path", default=DEFAULT_APP)
    ap.add_argument("--port", type=int, default=10430)
    ap.add_argument("--address", action="append", default=[])
    ap.add_argument("--trigger-channel", type=int)
    ap.add_argument("--profile")
    args = ap.parse_args(argv)

    addresses = [int(a, 0) for a in args.address] or None
    doc = run_capture(output=args.output, duration=args.duration, scl=args.scl, sda=args.sda,
                      sample_rate=args.sample_rate, simulate=args.simulate,
                      app_path=args.app_path, port=args.port, addresses=addresses,
                      trigger_channel=args.trigger_channel, profile_path=args.profile)
    print(f"采集完成：{len(doc['transactions'])} 个事务"
          f"（SCL={doc['meta']['scl_channel']} SDA={doc['meta']['sda_channel']}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_capture.py -v`
Expected: 5 passed

- [ ] **Step 5: 对真实硬件做一次端到端采集**

Run: `cd skills/saleae-i2c-debug && python3 scripts/i2c_capture.py -o /tmp/e2e.sal --duration 3 --address 0x2C`
Expected: 打印自动探测到的通道与候选排名，生成 `/tmp/e2e.json`。若探测结果不合理，**修 `score_decode` 而不是加特例**。

- [ ] **Step 6: 提交**

```bash
git add skills/saleae-i2c-debug
git commit -m "feat(skill): Saleae 自动采集与 SCL/SDA 通道探测"
```

---

### Task 5: 实时流入口 `i2c_live.py`

**Files:**
- Create: `skills/saleae-i2c-debug/scripts/i2c_live.py`
- Create: `skills/saleae-i2c-debug/tests/fixtures/sample_udp.jsonl`
- Create: `skills/saleae-i2c-debug/tests/test_live.py`

**Interfaces:**
- Consumes: `i2c_ingest.normalize`、`i2c_analyze.analyze`
- Produces:
  - `parse_udp_message(msg: dict) -> Optional[dict]`（把单条 HLA 消息转成事件，或返回 None）
  - `reassemble(messages: Iterable[dict]) -> list[dict]`（HLA 消息流 → 事务列表）
  - `serve(port: int, out_path: str, duration: float|None, on_event=None) -> dict`
  - `main(argv) -> int`

HLA 的 UDP 消息格式见 `i2c_hla/i2c_realtime.py`：`{"type": "START"|"STOP"|"ADDR"|"DATA"|"NACK"|"TX", "data": {...}}`。

- [ ] **Step 1: 造夹具与测试**

`tests/fixtures/sample_udp.jsonl`：
```
{"type":"START","data":{"time":0.001}}
{"type":"ADDR","data":{"time":0.0011,"addr":"0x2c","rw":"W"}}
{"type":"DATA","data":{"time":0.0012,"value":"0x1","raw":1}}
{"type":"DATA","data":{"time":0.0013,"value":"0x20","raw":32}}
{"type":"STOP","data":{"time":0.0014}}
{"type":"START","data":{"time":0.002}}
{"type":"ADDR","data":{"time":0.0021,"addr":"0x2c","rw":"R"}}
{"type":"DATA","data":{"time":0.0022,"value":"0x0","raw":0}}
{"type":"NACK","data":{"time":0.0023}}
{"type":"STOP","data":{"time":0.0024}}
```

`tests/test_live.py`：
```python
import json, pathlib
from i2c_live import reassemble, parse_udp_message

FIX = pathlib.Path(__file__).parent / "fixtures" / "sample_udp.jsonl"


def load():
    return [json.loads(l) for l in FIX.read_text().splitlines() if l.strip()]


def test_reassemble_splits_transactions():
    txs = reassemble(load())
    assert len(txs) == 2
    assert txs[0]["addr"] == 0x2C and txs[0]["rw"] == "W"
    assert txs[0]["bytes"] == [0x01, 0x20]


def test_reassemble_preserves_timestamps():
    tx = reassemble(load())[0]
    assert tx["start_time"] == 0.001
    assert tx["events"][0]["t"] == 0.001


def test_nack_marks_last_data_byte_ack_false():
    tx = reassemble(load())[1]
    assert tx["events"][-2]["type"] == "nack"
    assert tx["bytes"] == [0x00]


def test_unknown_message_returns_none():
    assert parse_udp_message({"type": "WAT", "data": {}}) is None


def test_start_flushes_previous_transaction():
    msgs = load()[:5] + [{"type": "START", "data": {"time": 0.009}},
                         {"type": "ADDR", "data": {"time": 0.0091, "addr": "0x15", "rw": "W"}}]
    txs = reassemble(msgs)
    assert len(txs) == 2
    assert txs[1]["addr"] == 0x15
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_live.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'i2c_live'`

- [ ] **Step 3: 实现 `i2c_live.py`**

```python
"""Consume the Logic 2 HLA UDP stream and normalize it incrementally."""
from __future__ import annotations

import argparse
import json
import socket
import sys
import time
from typing import Callable, Iterable, Optional

import i2c_ingest

DEFAULT_PORT = 50000


def parse_udp_message(msg: dict) -> Optional[dict]:
    kind = (msg.get("type") or "").upper()
    data = msg.get("data") or {}
    t = data.get("time")
    if kind == "START":
        return {"type": "start", "t": t}
    if kind == "STOP":
        return {"type": "stop", "t": t}
    if kind == "ADDR":
        return {"type": "address", "t": t, "addr": data.get("addr"), "rw": data.get("rw")}
    if kind == "DATA":
        return {"type": "data", "t": t, "value": data.get("value"), "raw": data.get("raw")}
    if kind == "NACK":
        return {"type": "nack", "t": t}
    return None


def _to_int(v) -> Optional[int]:
    if v is None:
        return None
    if isinstance(v, int):
        return v
    return int(str(v), 0)


class _Assembler:
    def __init__(self) -> None:
        self.transactions: list[dict] = []
        self.current: Optional[dict] = None

    def push(self, ev: dict) -> None:
        kind = ev["type"]
        if kind == "start":
            self._flush()
            self.current = {"start_time": ev["t"], "events": [ev], "bytes": [],
                            "addr": None, "rw": None}
        elif kind == "stop":
            if self.current is None:
                return
            self.current["events"].append(ev)
            self.current["end_time"] = ev["t"]
            self._flush()
        elif kind in ("address", "data", "nack"):
            if self.current is None:
                self.current = {"start_time": ev["t"], "events": [], "bytes": [],
                                "addr": None, "rw": None}
            if kind == "address":
                self.current["addr"] = _to_int(ev.get("addr"))
                self.current["rw"] = ev.get("rw")
                self.current["events"].append(
                    {"t": ev["t"], "type": "address", "value": self.current["addr"],
                     "ack": None})            # HLA 未提供 ACK，保持未知
            elif kind == "data":
                value = _to_int(ev.get("raw") if ev.get("raw") is not None else ev.get("value"))
                self.current["bytes"].append(value)
                self.current["events"].append(
                    {"t": ev["t"], "type": "data", "value": value, "ack": None})
            else:
                self.current["events"].append({"t": ev["t"], "type": "nack"})

    def _flush(self) -> None:
        if self.current is not None:
            self.transactions.append(self.current)
            self.current = None

    def finish(self) -> list[dict]:
        self._flush()
        return self.transactions


def reassemble(messages: Iterable[dict]) -> list[dict]:
    asm = _Assembler()
    for msg in messages:
        ev = parse_udp_message(msg)
        if ev is not None:
            asm.push(ev)
    txs = asm.finish()
    for i, tx in enumerate(txs):
        tx["index"] = i
        tx.setdefault("end_time", tx["events"][-1]["t"] if tx["events"] else tx["start_time"])
        tx["flags"] = []
    return txs


def serve(port: int, out_path: str, duration: Optional[float] = None,
          on_event: Optional[Callable[[dict], None]] = None) -> dict:
    asm = _Assembler()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", port))
    sock.settimeout(1.0)
    deadline = time.time() + duration if duration else None

    try:
        while True:
            if deadline and time.time() > deadline:
                break
            try:
                raw, _ = sock.recvfrom(65535)
            except socket.timeout:
                continue
            try:
                msg = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            ev = parse_udp_message(msg)
            if ev is None:
                continue
            before = len(asm.transactions)
            asm.push(ev)
            if on_event and len(asm.transactions) > before:
                on_event(asm.transactions[-1])
    finally:
        sock.close()

    txs = asm.finish()
    for i, tx in enumerate(txs):
        tx["index"] = i
        tx["flags"] = []
    doc = i2c_ingest.normalize(txs, source="udp",
                               meta={"scl_channel": None, "sda_channel": None,
                                     "timing_fidelity": "decoded", "port": port})
    i2c_ingest.write_normalized(doc, out_path)
    return doc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Consume Logic 2 HLA I2C over UDP")
    ap.add_argument("-o", "--output", default="live.json")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--duration", type=float, default=None)
    args = ap.parse_args(argv)
    print(f"监听 UDP {args.port} …", file=sys.stderr)
    doc = serve(args.port, args.output, args.duration)
    print(f"收到 {len(doc['transactions'])} 个事务 -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_live.py -v`
Expected: 5 passed

- [ ] **Step 5: 提交**

```bash
git add skills/saleae-i2c-debug
git commit -m "feat(skill): UDP 实时流入口"
```

---

### Task 6: 源码映射引擎 `i2c_map.py`

**Files:**
- Create: `skills/saleae-i2c-debug/scripts/i2c_map.py`
- Create: `skills/saleae-i2c-debug/references/source-mapping.md`
- Create: `skills/saleae-i2c-debug/tests/test_map.py`

**Interfaces:**
- Consumes: 归一化文档
- Produces:
  - `transaction_fingerprint(tx: dict) -> dict` → `{addr, rw, register, bytes, byte_len}`
  - `address_literals(addr: int) -> list[str]`（`0x2C` / `0x2c` / `44` / `0x58`）
  - `PRIMITIVES: dict[str, list[str]]`（按生态分类的 I2C 原语）
  - `scan_source(root: str, fingerprint: dict, langs: list[str]|None) -> list[dict]` → 候选 `{file, line, text, score, evidence}`
  - `map_document(doc: dict, source_root: str, top: int) -> dict`
  - `main(argv) -> int`

- [ ] **Step 1: 写失败的测试**

`tests/test_map.py`：
```python
import pathlib
import pytest
from i2c_map import (transaction_fingerprint, address_literals, scan_source,
                     map_document, PRIMITIVES)


def test_address_literals_cover_shifted_and_raw_forms():
    lits = address_literals(0x2C)
    assert "0x2C" in lits
    assert "0x2c" in lits
    assert "0x58" in lits        # 7-bit 左移后的 8-bit 写地址
    assert "44" in lits


def test_fingerprint_extracts_register_and_len():
    tx = {"addr": 0x2C, "rw": "W", "bytes": [0x01, 0x20]}
    fp = transaction_fingerprint(tx)
    assert fp["addr"] == 0x2C
    assert fp["register"] == 0x01
    assert fp["byte_len"] == 2
    assert fp["rw"] == "W"


def test_primitives_cover_major_ecosystems():
    for eco in ("linux", "baremetal", "windows-hid", "csharp", "python", "rust"):
        assert eco in PRIMITIVES
        assert PRIMITIVES[eco]


def test_scan_source_finds_matching_call(tmp_path):
    (tmp_path / "drv.c").write_text(
        '#include <linux/i2c.h>\n'
        'static int tp_write(struct i2c_client *c) {\n'
        '    u8 buf[2] = {0x01, 0x20};\n'
        '    return i2c_master_send(c, buf, 2);\n'
        '}\n')
    fp = transaction_fingerprint({"addr": 0x2C, "rw": "W", "bytes": [0x01, 0x20]})
    hits = scan_source(str(tmp_path), fp)
    assert hits
    assert any("i2c_master_send" in h["text"] for h in hits)
    assert hits[0]["file"].endswith("drv.c")


def test_scan_source_scores_address_match_higher(tmp_path):
    (tmp_path / "a.c").write_text("void f(void){ i2c_master_send(c, b, 2); }\n")
    (tmp_path / "b.c").write_text("void g(void){ x = 0x2C; i2c_master_send(c, b, 2); }\n")
    fp = transaction_fingerprint({"addr": 0x2C, "rw": "W", "bytes": [0x01, 0x20]})
    hits = scan_source(str(tmp_path), fp)
    best = max(hits, key=lambda h: h["score"])
    assert best["file"].endswith("b.c")


def test_map_document_reports_per_transaction(tmp_path):
    (tmp_path / "d.c").write_text("void f(void){ i2c_master_send(c, 0x2C, 2); }\n")
    doc = {"transactions": [{"index": 0, "addr": 0x2C, "rw": "W", "bytes": [0x01, 0x20]}]}
    result = map_document(doc, str(tmp_path), top=3)
    assert result["transactions"][0]["index"] == 0
    assert result["transactions"][0]["candidates"]
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_map.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'i2c_map'`

- [ ] **Step 3: 实现 `i2c_map.py`**

```python
"""Map observed I2C transactions back to candidate source-code locations."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Optional

PRIMITIVES: dict[str, list[str]] = {
    "linux": ["i2c_transfer", "i2c_master_send", "i2c_master_recv",
              "i2c_smbus_read_byte_data", "i2c_smbus_write_byte_data",
              "i2c_smbus_read_word_data", "i2c_smbus_write_word_data",
              "regmap_read", "regmap_write", "regmap_bulk_read", "regmap_bulk_write"],
    "baremetal": ["I2C_Write", "I2C_Read", "i2c_write", "i2c_read",
                  "HAL_I2C_Master_Transmit", "HAL_I2C_Master_Receive",
                  "WriteReg", "ReadReg", "REG_WRITE", "REG_READ", "write_reg", "read_reg"],
    "windows-hid": ["HidI2c", "IOCTL_HID_", "SpbWrite", "SpbRead", "SPB_TRANSFER"],
    "csharp": ["WriteI2C", "ReadI2C", "I2cDevice", "WriteRead", "ReadByte", "WriteByte"],
    "python": ["smbus2", "SMBus", "write_i2c_block_data", "read_i2c_block_data",
               "i2c_msg", "write_byte_data", "read_byte_data"],
    "rust": ["i2cdev", "write_read", "smbus", "I2cDevice"],
}

SOURCE_SUFFIXES = {".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".rs", ".py", ".ino"}
SKIP_DIRS = {".git", "node_modules", "target", "build", "dist", "__pycache__",
             ".venv", "venv", "out"}


def address_literals(addr: int) -> list[str]:
    """Textual forms an address may take in source, including the shifted form."""
    if addr is None:
        return []
    forms = {f"0x{addr:02X}", f"0x{addr:02x}", str(addr),
             f"0x{(addr << 1):02X}", f"0x{(addr << 1):02x}", str(addr << 1)}
    return sorted(forms)


def transaction_fingerprint(tx: dict) -> dict:
    data = [b for b in tx.get("bytes", []) if b is not None]
    return {
        "addr": tx.get("addr"),
        "rw": tx.get("rw"),
        "register": data[0] if data else None,
        "bytes": data,
        "byte_len": len(data),
    }


def _iter_sources(root: Path):
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix not in SOURCE_SUFFIXES:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        yield p


def scan_source(root: str, fingerprint: dict, langs: Optional[list[str]] = None) -> list[dict]:
    root_path = Path(root)
    ecosystems = langs or list(PRIMITIVES)
    needles = {name: eco for eco in ecosystems for name in PRIMITIVES[eco]}
    addr_forms = address_literals(fingerprint.get("addr"))
    reg = fingerprint.get("register")

    hits: list[dict] = []
    for path in _iter_sources(root_path):
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for lineno, text in enumerate(lines, start=1):
            matched = [n for n in needles if n in text]
            if not matched:
                continue
            score, evidence = 10.0, [f"调用 {matched[0]}"]
            if addr_forms and any(f in text for f in addr_forms):
                score += 40.0
                evidence.append("地址字面量命中")
            if reg is not None:
                reg_forms = {f"0x{reg:02X}", f"0x{reg:02x}", f"0x{reg:04X}", str(reg)}
                window = "\n".join(lines[max(0, lineno - 4):lineno + 3])
                if any(f in window for f in reg_forms):
                    score += 25.0
                    evidence.append("寄存器常量命中")
            if fingerprint.get("byte_len"):
                size_forms = [str(fingerprint["byte_len"]), f"0x{fingerprint['byte_len']:X}"]
                if any(f in text for f in size_forms):
                    score += 10.0
                    evidence.append("长度参数命中")
            if fingerprint.get("rw") == "R" and "I2C_M_RD" in text:
                score += 15.0
                evidence.append("读方向标记")
            hits.append({"file": str(path), "line": lineno,
                         "text": text.strip()[:200], "score": score,
                         "evidence": evidence})
    hits.sort(key=lambda h: -h["score"])
    return hits


def map_document(doc: dict, source_root: str, top: int = 5) -> dict:
    out = []
    for tx in doc.get("transactions", []):
        fp = transaction_fingerprint(tx)
        candidates = scan_source(source_root, fp)[:top]
        out.append({"index": tx.get("index"), "fingerprint": fp, "candidates": candidates})
    return {"source_root": source_root, "transactions": out}


def render_markdown(result: dict) -> str:
    lines = ["# 波形 ↔ 源码 映射候选", ""]
    for item in result["transactions"]:
        fp = item["fingerprint"]
        reg = f"{fp['register']:#04x}" if fp["register"] is not None else "—"
        lines += [f"## 事务 {item['index']} — addr={fp['addr'] and hex(fp['addr'])} "
                  f"{fp['rw']} reg={reg} len={fp['byte_len']}", ""]
        if not item["candidates"]:
            lines += ["未找到候选位置。", ""]
            continue
        lines += ["| 置信分 | 位置 | 代码 | 证据 |", "|---|---|---|---|"]
        for c in item["candidates"]:
            lines.append(f"| {c['score']:.0f} | `{c['file']}:{c['line']}` "
                         f"| `{c['text'][:80]}` | {', '.join(c['evidence'])} |")
        lines.append("")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Map I2C transactions back to source code")
    ap.add_argument("input")
    ap.add_argument("--src", required=True)
    ap.add_argument("-o", "--output", default="mapping.md")
    ap.add_argument("--json-output")
    ap.add_argument("--top", type=int, default=5)
    args = ap.parse_args(argv)

    doc = json.loads(Path(args.input).read_text(encoding="utf-8"))
    result = map_document(doc, args.src, top=args.top)
    Path(args.output).write_text(render_markdown(result), encoding="utf-8")
    if args.json_output:
        Path(args.json_output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"映射结果已写入 {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/test_map.py -v`
Expected: 6 passed

- [ ] **Step 5: 写 `references/source-mapping.md`**

内容需覆盖：`PRIMITIVES` 表的来源与扩展方式；地址字面量为何要考虑左移形式（7-bit 地址在代码里常写成 8-bit）；打分各项的含义与调参建议；以及**明确的诚实边界**——本引擎只给候选与证据，不做判定，置信分是启发式排序而非正确性保证。

- [ ] **Step 6: 提交**

```bash
git add skills/saleae-i2c-debug
git commit -m "feat(skill): 波形↔源码映射引擎"
```

---

### Task 7: SKILL.md 与参考资料

**Files:**
- Create: `skills/saleae-i2c-debug/SKILL.md`
- Create: `skills/saleae-i2c-debug/references/timing-specs.md`
- Create: `skills/saleae-i2c-debug/references/saleae-api.md`

**Interfaces:**
- Consumes: 前述全部脚本
- Produces: 无代码接口；产出为 skill 的触发条件与workflow 描述

- [ ] **Step 1: 写 `references/saleae-api.md`**

必须记录（全部来自实测，避免后人重复踩坑）：

1. `ELECTRON_RUN_AS_NODE` 陷阱与 `clean_env()` 的必要性
2. macOS 需传二进制路径
3. 分析器名大小写敏感；用 `add_analyzer("__bogus__")` 取得完整名单
4. `SCL`/`SDA` 设置须为 int
5. `RadixType.HEXADECIMAL` 的必要性，以及默认 radix 的字符编码陷阱（`0xFF` → `c3 bf`）
6. `columns=` 参数会丢列，不要用
7. CSV 表头退化的情况
8. 各 `.sal` 启用通道不同，需探测
9. 大抓包导出慢，需限制
10. 错误类型对照：`MissingDeviceError` / `Logic2AlreadyRunningError` / `IncompatibleApiVersionError` / `OutOfMemoryError` / `InvalidRequestError`

- [ ] **Step 2: 写 `references/timing-specs.md`**

放入 `BUS_MODE_LIMITS` 的完整阈值表（standard / fast / fast-plus / high-speed），标注来源为 NXP UM10204。另需写清**保真度分级**：哪些参数在 decoded 模式可信（事务时长、事务间隔、tBUF 近似），哪些必须 raw 模式（tLOW / tHIGH / tSU;DAT / tHD;DAT），以及如何用 `export_raw_data_csv` 取原始边沿。

- [ ] **Step 3: 写 `SKILL.md`**

frontmatter：
```yaml
---
name: saleae-i2c-debug
description: Capture and debug I2C traffic with Saleae Logic 2 — drive captures programmatically via the Automation API, analyze protocol/timing violations, and map observed transactions back to source code. Use this whenever the user mentions Saleae, Logic 2, .sal captures, I2C waveform/timing analysis, I2C protocol decoding, debugging an I2C driver or sensor, checking whether a device ACKed, measuring I2C setup/hold times, or asks to "抓 I2C 波形" / "看 I2C 时序" / "I2C 抓包分析" — even if they don't say the word "Saleae".
---
```

正文必须包含：

- **快速判断表**：用户给了 `.sal` / 要抓新波形 / 有实时流 → 分别走哪条入口
- **三条 workflow**，每条给出确切命令行（用本 skill 的脚本路径）
- **Profile 何时需要**：设备地址已知、需要寄存器语义时
- **反向验证怎么做**：明确指示用 `jq` 直接查 `transactions.json`，并给出 2-3 条 `jq` 示例（如「列出所有 NACK 事务」「统计 0x2C 的写序列」）
- **保真度纪律**：decoded 模式下不得声称 ns 级时序结论
- **常见失败**：Logic 2 起不来 → 检查 `ELECTRON_RUN_AS_NODE`；`channel not enabled` → 通道探测；找不到分析器 → 大小写

- [ ] **Step 4: 建立全局符号链接**

```bash
ln -sfn "$(pwd)/skills/saleae-i2c-debug" ~/.claude/skills/saleae-i2c-debug
ls -l ~/.claude/skills/
```
Expected: `saleae-i2c-debug -> /Users/zhouheng/claude/saleae-logic-proc/skills/saleae-i2c-debug`

- [ ] **Step 5: 全量测试**

Run: `cd skills/saleae-i2c-debug && python3 -m pytest tests/ -v`
Expected: 全部通过（Task 1–6 累计 42 个测试：profile 6 / ingest 10 / analyze 10 / capture 5 / live 5 / map 6）

- [ ] **Step 6: 提交**

```bash
git add skills/saleae-i2c-debug
git commit -m "feat(skill): SKILL.md 与参考资料，安装到 ~/.claude/skills"
```

---

### Task 8: Eval —— 用 skill-creator 流程验证并迭代

**Files:**
- Create: `skills/saleae-i2c-debug/evals/evals.json`
- Create: `skills/saleae-i2c-debug-workspace/`（迭代产物，不入 git）

**Interfaces:**
- Consumes: 已完成的 skill
- Produces: 评测结论与 skill 修订

- [ ] **Step 1: 写 3 个 eval prompt**

```json
{
  "skill_name": "saleae-i2c-debug",
  "evals": [
    {"id": 0, "prompt": "帮我看看 ~/Documents/lenovo开机时序.sal 里的 I2C 时序有没有问题",
     "expected_output": "自动探测通道、生成时序分析报告、列出违规", "files": []},
    {"id": 1, "prompt": "用 Saleae 抓 3 秒 I2C 然后分析一下，设备地址应该是 0x2C",
     "expected_output": "驱动 Automation API 完成采集+分析全链路，正确报告通道", "files": []},
    {"id": 2, "prompt": "这份 I2C 抓包里 0x2C 的写序列，是不是漏了 RESET 命令？在 Waratah 源码里找找对应的代码",
     "expected_output": "用 jq 查询归一化 JSON 给出证据，并给出源码候选位置", "files": []}
  ]
}
```

- [ ] **Step 2: 按 skill-creator 流程跑 with-skill 与 baseline**

用 skill-creator 的 subagent 机制并行跑 3 个 eval 的 with-skill 与 without-skill 两版，产物落 `skills/saleae-i2c-debug-workspace/iteration-1/`。

- [ ] **Step 3: 起草断言并聚合**

断言示例：「报告文件已生成」「识别出的 SCL/SDA 与真实通道一致」「NACK 被检出」「NS 级时序参数被标注为不可信」「源码候选含文件路径与行号」。

- [ ] **Step 4: 生成评审视图**

按 skill-creator 要求运行 `eval-viewer/generate_review.py`，让使用者过目定性输出与定量对比。

- [ ] **Step 5: 依反馈迭代**

读 `feedback.json`，修订 skill 后跑 `iteration-2/`。持续到使用者满意。

---

## 自检记录

**Spec 覆盖检查**

| Spec 章节 | 对应 Task |
|---|---|
| §4.2 归一化格式 | Task 2（含 `timing_fidelity`、`ack: null` 约定） |
| §4.3 分析引擎（8 项违规 + 时序参数 + 统计） | Task 3 |
| §4.4 源码映射（正向 + 反向） | Task 6（正向）+ Task 7 Step 3（反向用 jq，按 spec 不做成脚本） |
| §4.5 Profile 机制 | Task 1 |
| §5 组件清单 | Task 1–7 全覆盖 |
| §6 错误处理原则 | Task 2（列容错）、Task 3（保真度）、Task 4（通道探测与错误翻译） |
| §7 测试策略 | 各 Task 的单测 + Task 4 Step 5 真机 e2e + Task 8 eval |
| §8 阶段一 | Task 1–7 |
| §8 阶段二（HID-over-I²C 语义解码） | **未纳入本计划** —— 按 spec 属阶段二，另行开计划 |
| §9 未决问题 | 全部由探针解决，答案写入 Global Constraints |

**与 spec 的偏差（已修正 spec 中错误假设）**

- Spec §3 假设三个 `.sal` 都可用作测试素材。实测 `hp008 palm.sal` 在通道 5-9 上解码不出有意义流量，**不适合作为 I2C 夹具**。计划改用 `lenovo开机时序.sal` 与 `友商.sal`，并以手工合成的 CSV 夹具为主（确定性更好）。
- Spec §3 称「`add_analyzer` 于已加载抓包不可访问」源自库文档；实测**可以**新增并取得可用句柄。计划按实测结论写。

**占位符扫描**：无 TBD / TODO；所有代码步骤含完整可运行代码。

**类型一致性**：`Profile` 字段、`analyze()` 返回结构、`Finding` 键名、`rows_to_transactions` 参数在 Task 1–6 间保持一致；`i2c_ingest.parse_data_table_csv` 在 Task 2 定义、Task 4 复用，签名一致。

**自检中修掉的缺陷（记录在此，避免执行者重蹈）**

1. `rows_to_transactions` 原本在遇到重复起始位时直接覆盖 `current`，会**静默吞掉前一个事务**。已改为先 flush 再新建。
2. `test_detects_missing_restart` 原本断言夹具会触发 `MISSING_RESTART`，但夹具里唯一的「写后读」用的正是**正确的 Sr**，不该报。已拆成两个测试：正确 Sr 不报 + 专门的 STOP+START 夹具要报。
3. `tx_duration.min` 的断言值写成了 tx0 的时长，而四个事务里最短的是 tx3。已改为同时断言 min 与 max。
4. Task 4 `run_capture` 里的死变量 `probe_channels` 已删除。
5. Task 3 `render_markdown` 里规避 f-string 引号嵌套的字符拼接 hack 已改为局部变量。

**仍需执行时留意**

- `score_decode` 的权重（`-5.0` / `-200.0` / `+50.0`）是启发式初值，Task 4 Step 5 的真机验证就是用来校准它的。若探测仍选错，**调权重而非加特例分支** —— 加特例会让这个函数在换设备后失效。
- `i2c_live.py` 的 ACK 一律为 `null`，因为现有 HLA（`i2c_hla/i2c_realtime.py`）根本不推送逐字节 ACK。这是 live 入口的固有精度上限，报告里必须如实体现，不要用推断值填充。
