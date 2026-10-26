import json, subprocess, sys, re
pdf, out = sys.argv[1], sys.argv[2]
heads = ["ВВЕДЕНИЕ","1 Тестируемое устройство","1.1 Интерфейсы устройства","1.2 Функциональность","2 Тестовое окружение",
 "2.1 Интерфейс окружения","2.2 Обертка тестируемого устройства","2.3 Агенты окружения","2.4 Транзакции и драйверы","2.5 Мониторы",
 "3 Эталонная модель и табло статистики","3.1 Проверяемые характеристики","3.2 Эталонная модель","3.3 Табло статистики",
 "3.4 Схема тестового окружения","4 Последовательности и тесты","4.1 Тестовые сценарии","4.2 Рандомизация транзакций",
 "4.3 Последовательности","4.4 Регрессия","4.5 Оценка правильности работы устройства","4.6 Результаты CI","ЗАКЛЮЧЕНИЕ",
 "СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ"]
n = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout).group(1))
res = {}
for pg in range(3, n + 1):
    lines = [l.strip() for l in subprocess.run(["pdftotext", "-f", str(pg), "-l", str(pg), pdf, "-"], capture_output=True, text=True).stdout.splitlines()]
    for h in heads:
        if h not in res and h in lines: res[h] = pg
missing = [h for h in heads if h not in res]
assert not missing, missing
json.dump(res, open(out, "w"), ensure_ascii=False, indent=1); print(res)
