#!/usr/bin/env python3
"""
Saleae High Level Analyzer - I2C Real-time Exporter via UDP

This HLA runs inside Logic 2 and sends I2C data to a UDP socket in real-time.
Data format: each I2C transaction is sent as a UDP packet.
"""

import socket
import json
from saleae.analyzers import HighLevelAnalyzer, AnalyzerFrame

# UDP configuration
UDP_HOST = "127.0.0.1"
UDP_PORT = 50000

def bytes_to_int(b):
    """Convert bytes to integer."""
    if isinstance(b, int):
        return b
    if isinstance(b, bytes):
        return int.from_bytes(b, 'little')
    return int(b) if b else 0

class I2CRealtime(HighLevelAnalyzer):
    """High Level Analyzer for I2C real-time export via UDP."""

    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.current_addr = None
        self.current_rw = None
        self.transaction_data = []

    def send_udp(self, msg_type, data):
        """Send a UDP packet."""
        try:
            msg = json.dumps({"type": msg_type, "data": data})
            self.sock.sendto(msg.encode('utf-8'), (UDP_HOST, UDP_PORT))
        except Exception as e:
            pass

    def decode(self, frame: AnalyzerFrame):
        """
        Process each I2C frame and send via UDP.
        """
        try:
            frame_type = frame.type.lower() if hasattr(frame, 'type') else ''
            frame_data = frame.data if hasattr(frame, 'data') else {}

            timestamp = getattr(frame, 'start_time', 0)

            if frame_type == 'start':
                self.flush_transaction()
                self.send_udp("START", {"time": timestamp})

            elif frame_type == 'stop':
                self.flush_transaction()
                self.send_udp("STOP", {"time": timestamp})

            elif frame_type == 'address':
                addr = bytes_to_int(frame_data.get('address', 0))
                rw = 'R' if frame_data.get('read', False) else 'W'
                self.current_addr = addr
                self.current_rw = rw
                self.transaction_data = []
                self.send_udp("ADDR", {"time": timestamp, "addr": hex(addr), "rw": rw})

            elif frame_type == 'data':
                data = bytes_to_int(frame_data.get('data', 0))
                self.transaction_data.append(data)
                self.send_udp("DATA", {"time": timestamp, "value": hex(data), "raw": data})

            elif frame_type == 'ack':
                pass  # Skip ACK for cleaner output

            elif frame_type == 'nack':
                self.send_udp("NACK", {"time": timestamp})

            elif frame_type == 'result':
                # Combined result - extract data if present
                pass

        except Exception as e:
            self.send_udp("ERROR", {"msg": str(e)})

        return None

    def flush_transaction(self):
        """Send accumulated transaction data."""
        if self.current_addr is not None:
            self.send_udp("TX", {
                "addr": hex(self.current_addr),
                "rw": self.current_rw,
                "data": [hex(d) for d in self.transaction_data]
            })
            self.current_addr = None
            self.transaction_data = []

    def __del__(self):
        try:
            self.sock.close()
        except:
            pass
