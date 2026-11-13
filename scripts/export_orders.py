#!/usr/bin/env python3
"""Exporta os pedidos do SQLite para CSV (bibliotecas padrão do Python)."""
import csv
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "pizzaria.sqlite"
DEST = ROOT / "data" / "pedidos.csv"

if not DB.exists():
    raise SystemExit("Banco ainda não existe. Inicie o servidor Node.js e receba um pedido primeiro.")

with sqlite3.connect(DB) as con, DEST.open("w", newline="", encoding="utf-8-sig") as file:
    con.row_factory = sqlite3.Row
    rows = con.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
    writer = csv.writer(file, delimiter=";")
    writer.writerow(["Pedido", "Data", "Cliente", "Telefone", "Itens", "Pagamento", "Total", "Status", "Observações"])
    for row in rows:
        customer = json.loads(row["customer"])
        items = json.loads(row["items"])
        summary = " | ".join(f'{item["quantity"]}x {item["name"]} ({item["unitPrice"]:.2f})' for item in items)
        writer.writerow([row["id"], row["createdAt"], customer.get("name",""), customer.get("phone",""),
                         summary, row["payment"], f'{row["total"]:.2f}', row["status"], customer.get("notes","")])
print(f"Arquivo criado: {DEST}")
