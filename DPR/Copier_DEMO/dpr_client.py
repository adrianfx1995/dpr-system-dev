# === dpr_client.py (Python EA Client) ===
import socket
import MetaTrader5 as mt5
import time
import json
import threading
import os
import argparse

mt5_lock = threading.Lock()

# === Load Configuration ===
def load_config(path):
    try:
        with open(path, "r") as f:
            config = json.load(f)
            required_keys = ["broker", "account_number", "password", "server", "symbol", "host", "port", "mt5_path"]
            if not all(key in config for key in required_keys):
                raise ValueError("Missing required config keys.")
            return config
    except Exception as e:
        print(f"[CONFIG ERROR] {e}")
        exit(1)

# === Connect to MetaTrader 5 ===
def connect_to_mt5(account, password, server, mt5_path, instance_id):
    with mt5_lock:
        if not mt5.initialize(path=mt5_path):
            print(f"[{instance_id}] MT5_ERROR init_failed error={mt5.last_error()}")
            return False
        if not mt5.login(account, password=password, server=server):
            print(f"[{instance_id}] MT5_ERROR login_failed")
            return False

        acct = mt5.account_info()
        if acct is None:
            print(f"[{instance_id}] MT5_ERROR account_info_missing")
            return False

        acct_server = acct.server or ""
        cfg_server = server or ""
        acct_server_norm = acct_server.lower()
        cfg_server_norm = cfg_server.lower()
        server_ok = acct_server_norm == cfg_server_norm or cfg_server_norm in acct_server_norm
        if acct.login != account or not server_ok:
            print(f"[{instance_id}] MT5_ERROR account_mismatch login={acct.login} server={acct_server}")
            return False

        terminal_info = mt5.terminal_info()
        trade_allowed = terminal_info.trade_allowed if terminal_info else None
        connected = terminal_info.connected if terminal_info else None
        print(
            f"[{instance_id}] MT5_OK path={mt5_path} login={acct.login} "
            f"server={acct_server} trade_allowed={trade_allowed} connected={connected}"
        )
        return True

# === TCP Server Connection ===
def connect_to_server(host, port, instance_id):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    sock.connect((host, port))
    sock.settimeout(None)
    print(f"[{instance_id}] TCP_OK connected host={host} port={port}")
    return sock

# === Declare Broker to Server ===
def declare_broker(sock, broker, instance_id):
    try:
        sock.sendall("EA_CLIENT\n".encode("utf-8"))
        time.sleep(1)
        sock.sendall(f"BROKER {broker}\n".encode("utf-8"))
        print(f"[{instance_id}] SERVER broker_declared tag={broker}")
        return wait_for_registration_ack(sock, broker, instance_id)
    except Exception as e:
        print(f"[{instance_id}] SERVER_ERROR failed_to_declare_broker {e}")
        return [], ""

# === Registration Acknowledgement ===
def wait_for_registration_ack(sock, broker, instance_id):
    extra_messages = []
    remainder = ""
    sock.settimeout(3)
    try:
        data = sock.recv(1024)
        if not data:
            print(f"[{instance_id}] SERVER_WARN no registration ack received (continuing)")
            return extra_messages, remainder
        raw = data.decode("utf-8", errors="ignore")
        lines = raw.split("\n")
        if raw.endswith("\n"):
            remainder = ""
        else:
            remainder = lines.pop()
        ack_line = None
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if line.startswith("REGISTERED "):
                ack_line = line
            else:
                extra_messages.append(line)
        if ack_line:
            parts = ack_line.split()
            tag = parts[1] if len(parts) > 1 else broker
            count = parts[3] if len(parts) > 3 else "0"
            print(f"[{instance_id}] SERVER_OK registered tag={tag} peers_in_tag={count}")
        else:
            print(f"[{instance_id}] SERVER_WARN no registration ack received (continuing)")
    except socket.timeout:
        print(f"[{instance_id}] SERVER_WARN no registration ack received (continuing)")
    except Exception as e:
        print(f"[{instance_id}] SERVER_WARN registration ack error {e}")
    finally:
        sock.settimeout(None)
    return extra_messages, remainder

# === Trade Execution ===
def execute_trade(symbol, action, lot):
    with mt5_lock:
        if not mt5.symbol_select(symbol, True):
            print(f"[TRADE ERROR] Failed to select {symbol}")
            return

        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            print(f"[TRADE ERROR] No tick data for {symbol}")
            return

        price = tick.ask if action == "BUY" else tick.bid
        if price is None or price <= 0:
            print(f"[TRADE ERROR] Invalid price for {symbol}")
            return

        order_type = mt5.ORDER_TYPE_BUY if action == "BUY" else mt5.ORDER_TYPE_SELL

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": lot,
            "type": order_type,
            "price": price,
            "sl": 0.0,
            "tp": 0.0,
            "type_filling": mt5.ORDER_FILLING_FOK,
            "magic": 5430,
            "comment": "DPR"
        }

        result = mt5.order_send(request)
        if result.retcode == mt5.TRADE_RETCODE_DONE:
            print(f"[TRADE] {action} {lot} lot executed on {symbol}.")
        else:
            print(f"[TRADE FAIL] Code {result.retcode}, {result.comment}")

# === Close All Positions ===
def close_all_positions():
    with mt5_lock:
        positions = mt5.positions_get()
        if not positions:
            print("[CLOSE] No open positions.")
            return

        for pos in positions:
            if not mt5.symbol_select(pos.symbol, True):
                print(f"[CLOSE ERROR] Failed to select {pos.symbol}")
                continue

            tick = mt5.symbol_info_tick(pos.symbol)
            if tick is None:
                print(f"[CLOSE ERROR] No tick data for {pos.symbol}")
                continue

            opposite_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
            price = tick.bid if pos.type == mt5.ORDER_TYPE_BUY else tick.ask
            if price is None or price <= 0:
                print(f"[CLOSE ERROR] Invalid price for {pos.symbol}")
                continue

            request = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": pos.symbol,
                "volume": pos.volume,
                "type": opposite_type,
                "position": pos.ticket,
                "price": price,
                "type_filling": mt5.ORDER_FILLING_FOK,
                "magic": 5430,
                "comment": "DPR-CLOSE"
            }

            result = mt5.order_send(request)
            if result.retcode == mt5.TRADE_RETCODE_DONE:
                print(f"[CLOSE] Position {pos.ticket} closed.")
            else:
                print(f"[CLOSE FAIL] Position {pos.ticket} failed. Code {result.retcode}")

# === Close Positions by Side ===
def close_positions_by_side(side):
    with mt5_lock:
        positions = mt5.positions_get()
        if not positions:
            print("[CLOSE] No open positions.")
            return

        side = (side or "").upper()
        if side not in ["BUY", "SELL"]:
            print(f"[CLOSE] Invalid side: {side}")
            return

        matched = 0
        for pos in positions:
            if side == "BUY":
                if pos.type != mt5.POSITION_TYPE_BUY and pos.type != 0:
                    continue
                opposite_type = mt5.ORDER_TYPE_SELL
                comment = "DPR-CLOSE-BUY"
                price_side = "bid"
            else:
                if pos.type != mt5.POSITION_TYPE_SELL and pos.type != 1:
                    continue
                opposite_type = mt5.ORDER_TYPE_BUY
                comment = "DPR-CLOSE-SELL"
                price_side = "ask"

            if not mt5.symbol_select(pos.symbol, True):
                print(f"[CLOSE {side} ERROR] Failed to select {pos.symbol}")
                continue

            tick = mt5.symbol_info_tick(pos.symbol)
            if tick is None:
                print(f"[CLOSE {side} ERROR] No tick data for {pos.symbol}")
                continue

            price = tick.bid if price_side == "bid" else tick.ask
            if price is None or price <= 0:
                print(f"[CLOSE {side} ERROR] Invalid price for {pos.symbol}")
                continue

            matched += 1
            request = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": pos.symbol,
                "volume": pos.volume,
                "type": opposite_type,
                "position": pos.ticket,
                "price": price,
                "type_filling": mt5.ORDER_FILLING_FOK,
                "magic": 5430,
                "comment": comment
            }

            result = mt5.order_send(request)
            if result.retcode == mt5.TRADE_RETCODE_DONE:
                print(f"[CLOSE {side}] Position {pos.ticket} closed.")
            else:
                print(f"[CLOSE {side} FAIL] Position {pos.ticket} failed. Code {result.retcode}")

        if matched == 0:
            print(f"[CLOSE {side}] No positions to close.")

# === Close Profitable Positions ===
def close_profitable_positions():
    with mt5_lock:
        positions = mt5.positions_get()
        if not positions:
            print("[CLOSE PROFITS] No open positions.")
            return

        for pos in positions:
            if pos.profit > 0:
                if not mt5.symbol_select(pos.symbol, True):
                    print(f"[CLOSE PROFIT ERROR] Failed to select {pos.symbol}")
                    continue

                tick = mt5.symbol_info_tick(pos.symbol)
                if tick is None:
                    print(f"[CLOSE PROFIT ERROR] No tick data for {pos.symbol}")
                    continue

                opposite_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
                price = tick.bid if pos.type == mt5.ORDER_TYPE_BUY else tick.ask
                if price is None or price <= 0:
                    print(f"[CLOSE PROFIT ERROR] Invalid price for {pos.symbol}")
                    continue

                request = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "symbol": pos.symbol,
                    "volume": pos.volume,
                    "type": opposite_type,
                    "position": pos.ticket,
                    "price": price,
                    "type_filling": mt5.ORDER_FILLING_FOK,
                    "magic": 5430,
                    "comment": "DPR-CLOSE-PROFIT"
                }

                result = mt5.order_send(request)
                if result.retcode == mt5.TRADE_RETCODE_DONE:
                    print(f"[CLOSE PROFIT] Position {pos.ticket} closed.")
                else:
                    print(f"[CLOSE PROFIT FAIL] Ticket {pos.ticket}. Code {result.retcode}")

# === Message Processing ===
def process_message(message, symbol, instance_id):
    prefix = f"[{instance_id}] " if instance_id else ""
    try:
        data = json.loads(message)
        action = data.get("action")
        lot = data.get("lot", 0.0)

        if action in ["BUY", "SELL"]:
            execute_trade(symbol, action, float(lot))
        elif action == "HEDGE":
            execute_trade(symbol, "BUY", float(lot))
            execute_trade(symbol, "SELL", float(lot))
        elif action == "CLOSE_ALL":
            close_all_positions()
        elif action == "CLOSE_PROFITS":
            close_profitable_positions()
        elif action == "CLOSE_BUYS":
            close_positions_by_side("BUY")
        elif action == "CLOSE_SELLS":
            close_positions_by_side("SELL")
        else:
            print(f"{prefix}[UNKNOWN ACTION] {action}")
    except json.JSONDecodeError:
        print(f"{prefix}[ERROR] Invalid message format: {message}")
    except Exception as e:
        print(f"{prefix}[ERROR] message_processing_failed {e}")

# === Message Listener ===
def handle_messages(sock, symbol, instance_id, initial_messages=None, initial_buffer=""):
    buffer = initial_buffer or ""
    if initial_messages:
        for message in initial_messages:
            process_message(message, symbol, instance_id)
    while True:
        try:
            data = sock.recv(1024)
            if not data:
                print(f"[{instance_id}] SERVER_DISCONNECTED")
                return False
            buffer += data.decode("utf-8", errors="ignore")
            while "\n" in buffer:
                idx = buffer.index("\n")
                line = buffer[:idx].strip()
                buffer = buffer[idx + 1:]
                if not line:
                    continue
                process_message(line, symbol, instance_id)
        except Exception as e:
            print(f"[{instance_id}] ERROR {e}")
            return False

# === Keepalive Ping ===
def start_ping(sock, instance_id, stop_event):
    def ping():
        while not stop_event.wait(30):
            try:
                sock.sendall(b"\n")
            except Exception as e:
                print(f"[{instance_id}] PING_ERROR {e}")
                break

    thread = threading.Thread(target=ping, daemon=True)
    thread.start()
    return thread

# === Main ===
def main():
    default_config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
    parser = argparse.ArgumentParser(description="DPR MT5 execution client")
    parser.add_argument("--config", default=default_config_path, help="Path to config.json")
    args = parser.parse_args()

    config_path = os.path.abspath(args.config)
    config = load_config(config_path)
    instance_id = f"{config['broker']}-{config['account_number']}"
    print(
        f"[{instance_id}] CONFIG loaded path={config_path} broker={config['broker']} "
        f"account={config['account_number']} server={config['server']} "
        f"symbol={config['symbol']} host={config['host']} port={config['port']}"
    )
    attempt = 0
    backoff = 5

    while True:
        if attempt > 0:
            print(f"[{instance_id}] LOOP reconnecting attempt={attempt} backoff={backoff}")
            time.sleep(backoff)

        if not connect_to_mt5(
            config["account_number"],
            config["password"],
            config["server"],
            config["mt5_path"],
            instance_id,
        ):
            attempt += 1
            backoff = min(backoff * 2, 60)
            continue

        try:
            sock = connect_to_server(config["host"], config["port"], instance_id)
        except Exception as e:
            print(f"[{instance_id}] SERVER_ERROR {e}")
            attempt += 1
            backoff = min(backoff * 2, 60)
            continue

        attempt = 0
        backoff = 5
        initial_messages, initial_buffer = declare_broker(sock, config["broker"], instance_id)
        stop_event = threading.Event()
        start_ping(sock, instance_id, stop_event)
        handle_messages(sock, config["symbol"], instance_id, initial_messages, initial_buffer)
        stop_event.set()
        try:
            sock.close()
        except Exception:
            pass
        attempt = 1
        backoff = 5

if __name__ == "__main__":
    main()
