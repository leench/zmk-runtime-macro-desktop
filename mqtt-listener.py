#!/usr/bin/env python3
"""Listen to the Clipbridge MQTT broadcast and print received events."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import uuid

import paho.mqtt.client as mqtt

DEFAULT_PORT = 8883
DEFAULT_TOPIC = "clipbridge/v1/clipboard"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="订阅 Clipbridge 的 MQTT 广播并打印收到的消息。"
    )
    parser.add_argument("--host", required=True, help="MQTT 主机地址")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"MQTT TLS 端口（默认：{DEFAULT_PORT}）")
    parser.add_argument("--topic", default=DEFAULT_TOPIC, help=f"订阅主题（默认：{DEFAULT_TOPIC}）")
    parser.add_argument("--username", required=True, help="MQTT 只读客户端用户名")
    parser.add_argument(
        "--password",
        help="MQTT 密码；不填写时安全地从终端提示输入",
    )
    parser.add_argument(
        "--cafile",
        help="可选的 CA 文件；默认使用系统 CA（Let's Encrypt 无需填写）",
    )
    parser.add_argument(
        "--client-id",
        default=f"clipbridge-listener-{os.getpid()}-{uuid.uuid4().hex[:8]}",
        help="MQTT Client ID（默认自动生成）",
    )
    return parser.parse_args()


def print_event(payload: bytes) -> None:
    text = payload.decode("utf-8", errors="replace")
    try:
        event = json.loads(text)
    except json.JSONDecodeError:
        print("\n收到非 JSON 消息：", flush=True)
        print(text, flush=True)
        return

    print("\n========== 收到 Clipbridge 广播 ==========", flush=True)
    print(json.dumps(event, ensure_ascii=False, indent=2), flush=True)
    print("==========================================\n", flush=True)


def main() -> int:
    args = parse_args()
    password = args.password
    if password is None:
        password = getpass.getpass("MQTT 密码: ")

    client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id=args.client_id,
        clean_session=True,
    )
    client.username_pw_set(args.username, password)
    client.tls_set(ca_certs=args.cafile)
    client.tls_insecure_set(False)

    def on_connect(client, userdata, flags, reason_code, properties):
        if reason_code != 0:
            print(f"MQTT 连接失败：{reason_code}", file=sys.stderr, flush=True)
            return
        result, _ = client.subscribe(args.topic, qos=1)
        if result != mqtt.MQTT_ERR_SUCCESS:
            print(f"订阅失败：{mqtt.error_string(result)}", file=sys.stderr, flush=True)
            return
        print(
            f"已连接 MQTT：{args.host}:{args.port}\n"
            f"已订阅：{args.topic}\n"
            "等待广播（按 Ctrl+C 退出）...",
            flush=True,
        )

    def on_disconnect(client, userdata, disconnect_flags, reason_code, properties):
        if reason_code != 0:
            print(f"MQTT 连接断开，将自动重连：{reason_code}", file=sys.stderr, flush=True)

    def on_message(client, userdata, message):
        print_event(message.payload)

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message

    try:
        client.connect(args.host, args.port, keepalive=60)
        client.loop_forever(retry_first_connection=True)
    except KeyboardInterrupt:
        print("\n正在退出...", flush=True)
    except (OSError, mqtt.MQTTException) as exc:
        print(f"MQTT 连接错误：{exc}", file=sys.stderr, flush=True)
        return 1
    finally:
        client.disconnect()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
