#!/usr/bin/env bash
# Render each card in deck.html to a PNG named with its hold time, so the
# filename tells you the clip duration to set in the video editor.
#
#   ./render.sh          # 3840x2160 (2x), the default — crisp when scaled in a 1080p timeline
#   ./render.sh 1        # 1920x1080 (1x)
#
# Output: png/card-01-hold-7s.png … png/card-08-hold-11s.png
set -euo pipefail

cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME" >&2; exit 1; }

SCALE="${1:-2}"
OUT="png"
mkdir -p "$OUT"
rm -f "$OUT"/card-*.png

# Hold times, in card order — must match the data-hold attributes in deck.html.
HOLDS=(7 11 8 10 12 12 14 11)

for i in "${!HOLDS[@]}"; do
  n=$((i + 1))
  file=$(printf "%s/card-%02d-hold-%ss.png" "$OUT" "$n" "${HOLDS[$i]}")
  "$CHROME" \
    --headless \
    --disable-gpu \
    --hide-scrollbars \
    --default-background-color=00000000 \
    --force-device-scale-factor="$SCALE" \
    --window-size=1920,1080 \
    --screenshot="$file" \
    "file://$PWD/deck.html?card=$n" \
    >/dev/null 2>&1
  echo "  $file"
done

echo
echo "$((${#HOLDS[@]})) cards → $PWD/$OUT"
echo "Total card time: $(IFS=+; echo "$((${HOLDS[*]}))")s"
