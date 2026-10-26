#!/bin/bash
# Прогон окружения verification_lab (mant_shifter, вариант 14) в Verilator 5.020 + VCD для GTKWave.
# Использование: ./run.sh <путь к verification_lab> [seed]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
LAB=$(cd "$1" && pwd); SEED=${2:-12345}
WORK=$(mktemp -d); cp -r "$LAB" "$WORK/lab"
python3 -I "$HERE/vl_patch.py" "$WORK/lab"
cd "$WORK"; L=lab/unit_verif
verilator --binary --timing -j 4 -Wno-fatal -Wno-lint -Wno-style --trace --coverage-line --top-module tb_top --Mdir obj \
  -I"$HERE" -I$L -I$L/testbench -I$L/env -I$L/env/base -I$L/env/clk_agent -I$L/env/resetn_agent \
  -I$L/env/mant_in_agent -I$L/env/mant_out_agent -I$L/seq -I$L/tests \
  lab/rtl/mant_shifter.sv $L/testbench/tb_inc.sv >/dev/null
for t in base shift round stream reset; do
  ./obj/Vtb_top +${t}_test +verilator+seed+$SEED +trace=${t}_test.vcd > ${t}_test.log 2>&1
  echo "$t: $(grep -E 'COMPARES|COMPARE ERRORS|ORPHANS' ${t}_test.log | awk '{printf "%s %s; ", $1$2, $NF}')"
done
echo "VCD и логи: $WORK"
