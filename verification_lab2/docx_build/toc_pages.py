# Номера страниц заголовков по отрендеренному PDF: python3 toc_pages.py <report.pdf> <heads.json> <pages.json>
import json, subprocess, sys, re
pdf, heads_f, out = sys.argv[1:4]
heads = json.load(open(heads_f))
n = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout).group(1))
res, pos = {}, 0
for pg in range(3, n + 1):
    lines = [l.strip() for l in subprocess.run(["pdftotext", "-f", str(pg), "-l", str(pg), pdf, "-"], capture_output=True, text=True).stdout.splitlines()]
    while pos < len(heads) and heads[pos] in lines:   # заголовки идут по порядку
        res[heads[pos]] = pg; pos += 1
missing = heads[pos:]
assert not missing, missing
json.dump(res, open(out, "w"), ensure_ascii=False, indent=1)
print(pdf, n, "pages")
