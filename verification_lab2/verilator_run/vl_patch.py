# Патчит КОПИЮ лабы под Verilator 5.020: ручная рандомизация вместо constraint/with,
# счетчики бинов вместо covergroup, $finish вместо $stop, дамп VCD по +trace.
import re, sys, pathlib
root = pathlib.Path(sys.argv[1])
def sub(rel, old, new, count=1, regex=False):
    p = root / rel
    t = p.read_text()
    n = len(re.findall(old, t)) if regex else t.count(old)
    assert n >= 1, (rel, old)
    t = re.sub(old, new, t) if regex else t.replace(old, new)
    p.write_text(t)

# --- mant_in_tran: та же весовая схема 1:8:1 для shift, mant - любые 52 бита
sub("unit_verif/env/mant_in_agent/mant_in_tran.sv", "endclass : mant_in_tran", """
  // VERILATOR SHIM: ограничение shift_ctr + inline shift inside {[lo:hi]}
  function void vl_rand(int lo = 0, int hi = 63);
    int r;
    mant = {$urandom, $urandom};
    do begin
      r = $urandom_range(9, 0);
      if (r == 0)      shift = 0;
      else if (r == 9) shift = $urandom_range(63, 53);
      else             shift = $urandom_range(52, 1);
    end while (!(shift >= lo && shift <= hi));
  endfunction
endclass : mant_in_tran""")

# --- mant_seq
sub("unit_verif/seq/mant_seq.sv",
    "if (!mant_item.randomize() with {shift inside {[min_shift:max_shift]};})",
    "mant_item.vl_rand(min_shift, max_shift); if (0)")
sub("unit_verif/seq/mant_seq.sv", "endclass : mant_seq", """
  function void post_randomize();
    tran_num = $urandom_range(max_tran_num, min_tran_num);
  endfunction
endclass : mant_seq""")

# --- mant_round_seq: те же 10 случаев
cases = {
 0: "mant_item.vl_rand(5,5); mant_item.mant[4] = 0;",
 1: "mant_item.vl_rand(5,5); mant_item.mant[4:3] = 2'b11;",
 2: "mant_item.vl_rand(5,5); mant_item.mant[4:3] = 2'b10; mant_item.mant[2:0] = $urandom_range(7,1);",
 3: "mant_item.vl_rand(5,5); mant_item.mant[5:0] = 6'b010000;",
 4: "mant_item.vl_rand(5,5); mant_item.mant[5:0] = 6'b110000;",
 5: "mant_item.vl_rand(1,1); mant_item.mant = '1;",
 6: "mant_item.vl_rand(0,0); mant_item.mant = '1;",
 7: "mant_item.vl_rand(53,53); mant_item.mant = 0;",
 8: "do mant_item.vl_rand(53,53); while (mant_item.mant == 0);",
 9: "mant_item.vl_rand(63,63);",
}
for c, code in cases.items():
    sub("unit_verif/seq/mant_round_seq.sv", rf"\n      {c}: ok = mant_item\.randomize\(\) with \{{[^\n]*\}};",
        f"\n      {c}: begin {code} ok = 1; end", regex=True)

# --- resetn_transaction: soft-ограничения
sub("unit_verif/env/resetn_agent/resetn_transaction.sv", "endclass : resetn_transaction", """
  function void post_randomize();
    pre_rst_wait  = $urandom_range(5, 3);
    rst_wait      = $urandom_range(10, 5);
    post_rst_wait = $urandom_range(5, 1);
  endfunction
endclass : resetn_transaction""")

# --- base_test: wait_cycles inside {[5:10]}
sub("unit_verif/tests/base_test.sv", "void'(this.randomize(wait_cycles));", "wait_cycles = $urandom_range(10, 5);")

# --- tb_top: $finish и дамп VCD
sub("unit_verif/testbench/tb_top.sv", "$stop; // End the simulation", "$finish; // End the simulation")
sub("unit_verif/testbench/tb_top.sv", "  initial begin\n", """  initial begin
    string vcd;
    if ($value$plusargs("trace=%s", vcd)) begin
      $dumpfile(vcd);
      $dumpvars(0, tb_top.w);
    end
""")

# --- RTL: covergroup -> те же бины на счетчиках, сэмплирование по negedge clk
p = root / "rtl/mant_shifter.sv"
t = p.read_text()
i = t.index("/* FUNCTIONAL COVERAGE */")
t = t[:i] + """/* FUNCTIONAL COVERAGE (Verilator shim, те же бины) */
    int unsigned cov_bins [7];
    bit          vh [$];
    function automatic bit sparse_hit();
        int k = vh.size() - 1, z;
        if (k < 0 || vh[k] !== 1) return 0;
        for (int rep = 0; rep < 2; rep++) begin
            z = 0; k--;
            while (k >= 0 && vh[k] === 0) begin z++; k--; end
            if (z < 1 || z > 5 || k < 0 || vh[k] !== 1) return 0;
        end
        return 1;
    endfunction
    always @(negedge clk) begin
        if (in_valid === 1) begin
            if (in_shift == 0)           cov_bins[0]++;
            else if (in_shift <= MANT_W) cov_bins[1]++;
            else                         cov_bins[2]++;
        end
        vh.push_back(in_valid === 1);
        if (vh.size() > 13) void'(vh.pop_front());
        if (sparse_hit()) cov_bins[3]++;
        if (vh.size() >= 3 && vh[$] && vh[$-1] && vh[$-2]) cov_bins[4]++;
        if (stage1_valid === 1) begin
            if (round_up) cov_bins[5]++; else cov_bins[6]++;
        end
    end
    final begin
        $display("COVERBIN ZERO_SHIFT                        %0d", cov_bins[0]);
        $display("COVERBIN SHIFT_LESSER_THAN_MANTISSA_WIDTH  %0d", cov_bins[1]);
        $display("COVERBIN SHIFT_GREATER_THAN_MANTISSA_WIDTH %0d", cov_bins[2]);
        $display("COVERBIN INPUT_VALUES_SPARSE_STREAM        %0d", cov_bins[3]);
        $display("COVERBIN INPUT_VALUES_TIGHT_STREAM         %0d", cov_bins[4]);
        $display("COVERBIN AFTER_GRS_ROUND_UP                %0d", cov_bins[5]);
        $display("COVERBIN AFTER_GRS_ROUND_DOWN              %0d", cov_bins[6]);
    end
endmodule
"""
p.write_text(t)
print("patched OK")

# --- Questa допускает передачу специализаций env_base_sequencer#(...) в аргумент типа
# env_base_sequencer (базовый код курса), Verilator - нет. Общий непараметризованный предок.
sub("unit_verif/env/base/env_base_sequencer.sv",
    "class env_base_sequencer # (type TRAN = base_transaction, DRV = env_base_driver);",
    """virtual class env_seqr_base;
  pure virtual task driver_req(base_transaction transaction);
endclass

class env_base_sequencer # (type TRAN = base_transaction, DRV = env_base_driver) extends env_seqr_base;""")
sub("unit_verif/env/base/env_base_sequencer.sv",
    "extern virtual task driver_req(TRAN transaction);",
    "extern virtual task driver_req(base_transaction transaction);")
sub("unit_verif/env/base/env_base_sequencer.sv",
    "task env_base_sequencer::driver_req(TRAN transaction);\n  driver.request(transaction);",
    "task env_base_sequencer::driver_req(base_transaction transaction);\n  TRAN t;\n  if (!$cast(t, transaction)) $fatal(1, \"bad tran type\");\n  driver.request(t);")
sub("unit_verif/seq/base_seq.sv", "env_base_sequencer", "env_seqr_base")
sub("unit_verif/seq/seq_pkg.sv", "import env_base_pkg::env_base_sequencer;",
    "import env_base_pkg::env_base_sequencer;\n  import env_base_pkg::env_seqr_base;")
print("patched2 OK")

# --- Verilator 5.020 не генерирует C++ для "event x = null" в параметризованных классах
for f in ["env_base_ref.sv", "env_scoreboard.sv", "env_base_agent.sv", "env_base_driver.sv", "env_base_monitor.sv"]:
    sub("unit_verif/env/base/" + f, r"(event\s+stop_event)\s*=\s*null;", r"\1;", regex=True)
print("patched3 OK")

# --- зеркало сигналов интерфейса для VCD (записи через VIF Verilator 5.020 в трассу не попадают)
sub("unit_verif/testbench/tb_top.sv", "endmodule : tb_top", """  wave_mirror w (dut_intf);
endmodule : tb_top

module wave_mirror (env_if i);
  logic        clk /*verilator public_flat_rw*/;
  logic        resetn /*verilator public_flat_rw*/;
  logic        in_valid /*verilator public_flat_rw*/;
  logic        out_valid /*verilator public_flat_rw*/;
  logic [51:0] in_mant /*verilator public_flat_rw*/;
  logic [51:0] out_mant /*verilator public_flat_rw*/;
  logic [5:0]  in_shift /*verilator public_flat_rw*/;
  always @(i.clk)       clk       = i.clk;
  always @(i.resetn)    resetn    = i.resetn;
  always @(i.in_mant)   in_mant   = i.in_mant;
  always @(i.in_shift)  in_shift  = i.in_shift;
  always @(i.in_valid)  in_valid  = i.in_valid;
  always @(i.out_mant)  out_mant  = i.out_mant;
  always @(i.out_valid) out_valid = i.out_valid;
endmodule""")
print("patched4 OK")
