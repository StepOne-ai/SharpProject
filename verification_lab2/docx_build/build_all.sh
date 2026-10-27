#!/bin/bash
# Сборка трех отчетов: DOCX -> PDF (LibreOffice) -> номера страниц -> повторная сборка
set -e
cd "$(dirname "$0")"
LAB=$1; OUT=$2; mkdir -p "$OUT"
SOFF=/root/.claude/skills/synced/ec52965f-9f2b-494c-9578-3462351777ae_8e329c39-6d86-45a2-b97b-69510b644edd/docx/scripts/office/soffice.py
for r in lab2 lab3 dz; do
  for pass in 1 2 3; do
    node $r.js "$LAB" "$OUT/$r.docx" "$OUT/$r.pages.json" >/dev/null
    python3 $SOFF --headless --convert-to pdf --outdir "$OUT" "$OUT/$r.docx" >/dev/null 2>&1
    cp "$OUT/$r.pages.json" "$OUT/$r.prev.json" 2>/dev/null || true
    python3 -I toc_pages.py "$OUT/$r.pdf" "$OUT/$r.docx.heads.json" "$OUT/$r.pages.json"
    cmp -s "$OUT/$r.pages.json" "$OUT/$r.prev.json" && break
  done
done
