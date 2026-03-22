#!/usr/bin/env python3
"""
I2C UDP Receiver
Listens on UDP port 50000 and prints I2C data in real-time.
Data format from HLA: JSON {type, data}

Usage:
    python3 i2c_udp_receiver.py
"""

import socket
import json
import sys

UDP_PORT = 50000

def main():
    print("=" * 60)
    print("I2C Real-time UDP Receiver")
    print("Listening on UDP port", UDP_PORT)
    print("=" * 60)
    print()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", UDP_PORT))

    print("Waiting for I2C data...\n")

    try:
        while True:
            data, addr = sock.recvfrom(4096)
            try:
                msg = json.loads(data.decode('utf-8'))
                msg_type = msg.get('type', '')
                msg_data = msg.get('data', {})

                if msg_type == "START":
                    print("\n--- START ---")

                elif msg_type == "STOP":
                    print("--- STOP ---\n")

                elif msg_type == "ADDR":
                    addr_val = msg_data.get('addr', '0x0')
                    rw = msg_data.get('rw', '-')
                    print(f"  ADDR: {addr_val} [{rw}]")

                elif msg_type == "DATA":
                    val = msg_data.get('value', '0x0')
                    raw = msg_data.get('raw', 0)
                    print(f"  DATA: {val} ({raw})")

                elif msg_type == "TX":
                    addr_val = msg_data.get('addr', '0x0')
                    rw = msg_data.get('rw', '-')
                    data_list = msg_data.get('data', [])
                    data_str = ' '.join(data_list)
                    print(f">>> TX: {addr_val} [{rw}] {data_str}")

                elif msg_type == "ACK":
                    pass  # Skip ACK

                elif msg_type == "NACK":
                    print("  NACK!")

                elif msg_type == "ERROR":
                    print(f"ERROR: {msg_data.get('msg', 'unknown')}")

            except json.JSONDecodeError:
                print(f"Non-JSON data: {data[:100]}")
            except Exception as e:
                print(f"Error: {e}")
                continue

    except KeyboardInterrupt:
        print("\n\nReceiver stopped.")
    finally:
        sock.close()

if __name__ == "__main__":
    main()
