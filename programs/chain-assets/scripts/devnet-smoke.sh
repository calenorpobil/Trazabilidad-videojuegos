#!/usr/bin/env bash
# Prueba manual contra devnet (fuera de la CI, propuesta, 9): crea un juego y dos tipos
# (típico y máximo que cabe) y mide renta (P1), firmas (P6), tamaño y cómputo (P7).
# Uso, desde la raíz del repositorio: programs/chain-assets/scripts/devnet-smoke.sh [keypair]
set -euo pipefail

RPC="${RPC:-https://api.devnet.solana.com}"
KEYPAIR="${1:-$HOME/.config/solana/id.json}"
GAME_ID="oc1-$(date +%s)"

rpc() { curl -sS "$RPC" -H 'Content-Type: application/json' -d "$1"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

cargo build -q -p chain-assets --example devnet_tx
TX_BIN=target/debug/examples/devnet_tx

send() {
  local blockhash tx sig
  blockhash=$(rpc '{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash","params":[{"commitment":"confirmed"}]}' | json 'd["result"]["value"]["blockhash"]')
  tx=$("$TX_BIN" "$KEYPAIR" "$blockhash" "$@" 2> >(tee /dev/stderr > /tmp/devnet_tx.err))
  sig=$(rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sendTransaction\",\"params\":[\"$tx\",{\"encoding\":\"base64\",\"preflightCommitment\":\"confirmed\"}]}" | json 'd.get("result") or d')
  echo "firma=$sig"
  for _ in $(seq 1 30); do
    local status
    status=$(rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getSignatureStatuses\",\"params\":[[\"$sig\"]]}" | json '(d["result"]["value"][0] or {}).get("confirmationStatus")')
    [ "$status" = "confirmed" ] || [ "$status" = "finalized" ] && break
    sleep 2
  done
  rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":[\"$sig\",{\"commitment\":\"confirmed\",\"maxSupportedTransactionVersion\":0}]}" \
    | json '"err=%s cu=%s firmas=%d fee=%d" % (d["result"]["meta"]["err"], d["result"]["meta"]["computeUnitsConsumed"], len(d["result"]["transaction"]["signatures"]), d["result"]["meta"]["fee"])'
}

account() {
  rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$1\",{\"encoding\":\"base64\",\"commitment\":\"confirmed\"}]}" \
    | json '"lamports=%d bytes=%d owner=%s" % (d["result"]["value"]["lamports"], len(__import__("base64").b64decode(d["result"]["value"]["data"][0])), d["result"]["value"]["owner"])'
}

echo "== initialize_game $GAME_ID"
send init "$GAME_ID"
game=$(sed -n 's/^game=//p' /tmp/devnet_tx.err)
echo "Game: $(account "$game")"

for kind in typical max; do
  seed=$([ "$kind" = typical ] && echo 1 || echo 2)
  echo "== create_item $kind"
  send create "$GAME_ID" "$seed" "$kind"
  mint=$(sed -n 's/^mint=//p' /tmp/devnet_tx.err)
  echo "Mint: $(account "$mint")"
done
