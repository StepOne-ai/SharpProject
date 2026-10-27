// Общая часть генератора отчетов (ГОСТ 7.32, профиль ИУ6): стили, титул, таблицы, листинги, рисунки.
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType,
  AlignmentType, BorderStyle, Footer, PageNumber, TabStopType, VerticalAlign, VerticalMergeType,
  TableLayoutType, HeightRule,
} = require("docx");
const IMG = path.join(__dirname, "img");

const NB = " ";
const TW = 9355;            // ширина текста, DXA: 210 - 30 - 15 мм
const PX = TW / 15;         // ширина текста в px (1 px = 15 DXA)
const IND = 709;            // абзацный отступ 1,25 см
const FONT = "Times New Roman";
const MONO = "Courier New";

// ---------------------------------------------------------------- базовые блоки
const run = (t, o = {}) => new TextRun({ text: t, font: o.font || FONT, size: o.size || 28, bold: o.bold, italics: o.italics });

function P(text, o = {}) {
  const runs = Array.isArray(text) ? text : [run(text, o)];
  return new Paragraph({
    style: o.after ? "AfterTable" : undefined,
    alignment: o.align || AlignmentType.JUSTIFIED,
    indent: o.noIndent ? undefined : { firstLine: IND },
    keepNext: o.keepNext,
    children: runs,
  });
}
const Li = (text, o = {}) => P("–" + NB + text, o);                       // пункт перечисления
const HEADS = [];
const H1 = (t) => { HEADS.push([1, t]); return new Paragraph({ style: "Heading1", children: [run(t, { bold: true })] }); };
const H2 = (t, o = {}) => (HEADS.push([2, t]), new Paragraph({ style: o.after ? "Heading2AfterTable" : "Heading2", children: [run(t, { bold: true })] }));
const Cap = (t) => new Paragraph({ style: "TableCaption", children: [run(t)] });   // подпись таблицы/листинга

function Fig(file, widthPx, caption) {
  const buf = fs.readFileSync(path.join(IMG, file));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  return [
    new Paragraph({
      style: "Figure",
      children: [new ImageRun({ type: "png", data: buf, transformation: { width: widthPx, height: Math.round(widthPx * h / w) } })],
    }),
    new Paragraph({ style: "FigureCaption", children: [run(caption)] }),
  ];
}

// ---------------------------------------------------------------- таблицы
const B = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const BORDERS = { top: B, bottom: B, left: B, right: B, insideHorizontal: B, insideVertical: B };
const NOB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NOBORDERS = { top: NOB, bottom: NOB, left: NOB, right: NOB, insideHorizontal: NOB, insideVertical: NOB };
const CM = { top: 20, bottom: 20, left: 70, right: 70 };

function cellPar(t, o = {}) {
  return new Paragraph({
    style: "TableText",
    keepNext: o.keepNext,
    alignment: o.align || AlignmentType.LEFT,
    children: [run(t, { size: o.size || 24, bold: o.bold, font: o.font })],
  });
}
// rows: массив строк; ячейка - строка текста | {t, align, font, size, vmerge: "restart"|"continue"}
function Tbl(widths, header, rows, o = {}) {
  const hdr = new TableRow({
    tableHeader: true, cantSplit: true,
    children: header.map((h, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA }, margins: CM, verticalAlign: VerticalAlign.CENTER,
      children: h.split("\n").map((x) => cellPar(x, { bold: true, align: AlignmentType.CENTER, keepNext: true })),
    })),
  });
  const body = rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((c, i) => {
      const cc = typeof c === "string" ? { t: c } : c;
      const align = cc.align || (o.center && o.center.includes(i) ? AlignmentType.CENTER : AlignmentType.LEFT);
      return new TableCell({
        width: { size: widths[i], type: WidthType.DXA }, margins: CM, verticalAlign: VerticalAlign.CENTER,
        verticalMerge: cc.vmerge === "restart" ? VerticalMergeType.RESTART : cc.vmerge === "continue" ? VerticalMergeType.CONTINUE : undefined,
        children: cc.t.split("\n").map((x) => cellPar(x, { align, font: cc.font, size: cc.size, keepNext: ri < rows.length - 1 })),
      });
    }),
  }));
  return new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, borders: BORDERS, rows: [hdr, ...body] });
}

// листинг в рамке
function Lst(code) {
  const lines = code.replace(/\s+$/, "").split("\n");
  return new Table({
    width: { size: TW, type: WidthType.DXA }, columnWidths: [TW], layout: TableLayoutType.FIXED, borders: BORDERS,
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({
      width: { size: TW, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: lines.map((l) => new Paragraph({ style: "Code", children: [new TextRun({ text: l.length ? l : " ", font: MONO, size: 20 })] })),
    })] })],
  });
}


// ---------------------------------------------------------------- титульный лист
function titlePage(meta) {
  const crest = fs.readFileSync(path.join(IMG, "crest.png"));
  const hdr = ["Министерство науки и высшего образования Российской Федерации",
    "Федеральное государственное автономное образовательное учреждение", "высшего образования",
    "«Московский государственный технический университет", "имени Н.Э. Баумана",
    "(национальный исследовательский университет)»", "(МГТУ им. Н.Э. Баумана)"];
  const tp = (children, o = {}) => new Paragraph({ style: "TitleText", alignment: o.align || AlignmentType.LEFT, spacing: o.spacing, children });
  const t12 = (t, b) => run(t, { size: 24, bold: b });
  const head = new Table({
    width: { size: TW, type: WidthType.DXA }, columnWidths: [1300, TW - 1300], layout: TableLayoutType.FIXED, borders: NOBORDERS,
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: 1300, type: WidthType.DXA }, borders: NOBORDERS, children: [
        tp([new ImageRun({ type: "png", data: crest, transformation: { width: 77, height: 87 } })]) ] }),
      new TableCell({ width: { size: TW - 1300, type: WidthType.DXA }, borders: NOBORDERS,
        children: hdr.map((h) => tp([run(h, { size: 22, bold: true })], { align: AlignmentType.CENTER })) }),
    ] })],
  });
  const sig = (who, name) => new Table({
    width: { size: TW, type: WidthType.DXA }, columnWidths: [4100, 2700, 2555], layout: TableLayoutType.FIXED, borders: NOBORDERS,
    rows: [
      new TableRow({ children: [
        new TableCell({ width: { size: 4100, type: WidthType.DXA }, borders: NOBORDERS, children: [tp([t12(who)])] }),
        new TableCell({ width: { size: 2700, type: WidthType.DXA }, borders: NOBORDERS, children: [tp([t12("_______________")], { align: AlignmentType.CENTER })] }),
        new TableCell({ width: { size: 2555, type: WidthType.DXA }, borders: NOBORDERS, children: [tp([t12(name)], { align: AlignmentType.CENTER })] }),
      ] }),
      new TableRow({ children: [
        new TableCell({ width: { size: 4100, type: WidthType.DXA }, borders: NOBORDERS, children: [tp([])] }),
        new TableCell({ width: { size: 2700, type: WidthType.DXA }, borders: NOBORDERS, children: [tp([run("Подпись, дата", { size: 18, italics: true })], { align: AlignmentType.CENTER })] }),
        new TableCell({ width: { size: 2555, type: WidthType.DXA }, borders: NOBORDERS, children: [tp([run("(И.О. Фамилия)", { size: 18, italics: true })], { align: AlignmentType.CENTER })] }),
      ] }),
    ],
  });
  const gap = (n) => Array.from({ length: n }, () => tp([run("")]));
  return [
    head, ...gap(1),
    tp([t12("ФАКУЛЬТЕТ "), t12("Информатика и системы управления", true)]),
    tp([t12("КАФЕДРА "), t12("Компьютерные системы и сети (ИУ6)", true)]),
    tp([t12("НАПРАВЛЕНИЕ ПОДГОТОВКИ "), t12("09.03.01 Информатика и вычислительная техника", true)]),
    tp([t12("БАКАЛАВРСКАЯ ПРОГРАММА "), t12("09.03.01/03 Вычислительные машины, комплексы, системы и сети", true)]),
    ...gap(1),
    tp([run("ОТЧЕТ", { size: 36, bold: true })], { align: AlignmentType.CENTER }),
    meta.lab ? tp([run("по лабораторной работе № ", { bold: true }), run(String(meta.lab), { bold: true, size: 32 })], { align: AlignmentType.CENTER })
             : tp([run("по домашнему заданию", { bold: true })], { align: AlignmentType.CENTER }),
    tp([run("Вариант ", { bold: true }), run("14", { bold: true, size: 32 })], { align: AlignmentType.CENTER }),
    tp([run(`«${meta.topic}»`, { bold: true })], { align: AlignmentType.CENTER, spacing: { before: 240 } }),
    tp([t12("Дисциплина: "), t12("Организация ЭВМ и систем", true)], { align: AlignmentType.CENTER, spacing: { before: 120 } }),
    ...gap(2),
    sig("Студент группы ИУ6-72Б", "С.Ю. Кондратов"), ...gap(1),
    sig("Преподаватель", "А.Ю. Попов"), ...gap(2),
    tp([t12("Оценка ______________")]),
  ];
}

// ---------------------------------------------------------------- документ
function build(meta, body, OUT, PAGES) {
const tocPars = HEADS.map(([lvl, t]) => new Paragraph({
  style: "TocLine",
  indent: { left: lvl === 2 ? 560 : 0 },
  tabStops: [{ type: TabStopType.RIGHT, position: TW, leader: "dot" }],
  children: [run(`${t}\t${PAGES[t] || 0}`)],
}));
const doc = new Document({
  creator: "С.Ю. Кондратов",
  title: meta.docTitle,
  styles: {
    default: { document: { run: { font: FONT, size: 28 }, paragraph: { spacing: { line: 360, lineRule: "auto", before: 0, after: 0 } } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 28, bold: true, color: "000000" },
        paragraph: { alignment: AlignmentType.CENTER, spacing: { line: 360, lineRule: "auto", before: 0, after: 0 }, pageBreakBefore: true, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 28, bold: true, color: "000000" },
        paragraph: { alignment: AlignmentType.LEFT, indent: { firstLine: IND }, spacing: { line: 360, lineRule: "auto", before: 0, after: 0 }, keepNext: true, keepLines: true, outlineLevel: 1 } },
      { id: "Heading2AfterTable", name: "Заголовок 2 после таблицы", basedOn: "Heading2", next: "Normal",
        run: { font: FONT, size: 28, bold: true, color: "000000" },
        paragraph: { alignment: AlignmentType.LEFT, indent: { firstLine: IND }, spacing: { line: 360, lineRule: "auto", before: 120, after: 0 }, keepNext: true, outlineLevel: 1 } },
      { id: "AfterTable", name: "Текст после таблицы", basedOn: "Normal", next: "Normal",
        paragraph: { spacing: { line: 360, lineRule: "auto", before: 120, after: 0 } } },
      { id: "TableCaption", name: "Подпись таблицы", basedOn: "Normal", next: "Normal",
        paragraph: { alignment: AlignmentType.LEFT, spacing: { line: 360, lineRule: "auto", before: 0, after: 0 }, keepNext: true, keepLines: true } },
      { id: "Figure", name: "Рисунок", basedOn: "Normal", next: "FigureCaption",
        paragraph: { alignment: AlignmentType.CENTER, spacing: { line: 240, lineRule: "auto", before: 0, after: 0 }, keepNext: true } },
      { id: "FigureCaption", name: "Подпись рисунка", basedOn: "Normal", next: "Normal",
        paragraph: { alignment: AlignmentType.CENTER, spacing: { line: 360, lineRule: "auto", before: 0, after: 0 }, keepLines: true } },
      { id: "TableText", name: "Текст в таблице", basedOn: "Normal",
        run: { size: 24 }, paragraph: { spacing: { line: 240, lineRule: "auto", before: 0, after: 0 } } },
      { id: "Code", name: "Листинг", basedOn: "Normal",
        run: { font: MONO, size: 20 }, paragraph: { alignment: AlignmentType.LEFT, indent: { left: 360, hanging: 360 }, spacing: { line: 240, lineRule: "auto", before: 0, after: 0 } } },
      { id: "TocLine", name: "Строка содержания", basedOn: "Normal",
        paragraph: { alignment: AlignmentType.LEFT, spacing: { line: 360, lineRule: "auto", before: 0, after: 0 } } },
      { id: "TitleText", name: "Текст титула", basedOn: "Normal",
        paragraph: { spacing: { line: 240, lineRule: "auto", before: 0, after: 0 } } },
      { id: "Source", name: "Источник", basedOn: "Normal",
        paragraph: { alignment: AlignmentType.JUSTIFIED, indent: { firstLine: IND }, spacing: { line: 360, lineRule: "auto", before: 0, after: 0 } } },
    ],
  },
  sections: [{
    properties: {
      titlePage: true,
      page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1701, right: 850, footer: 567 } },
    },
    footers: {
      first: new Footer({ children: [new Paragraph({ children: [] })] }),
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 28 })] })] }),
    },
    children: [
      ...titlePage(meta),
      new Paragraph({ style: "TitleText", alignment: AlignmentType.CENTER, pageBreakBefore: false, spacing: { before: meta.mskGap || 4700 },
        children: [run("Москва, 2026 г.", { size: 24 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, pageBreakBefore: true, keepNext: true, children: [run("СОДЕРЖАНИЕ", { bold: true })] }),
      ...tocPars,
      ...body,
    ],
  }],
});

fs.writeFileSync(OUT + ".heads.json", JSON.stringify(HEADS.map(([, h]) => h)));
return Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT, b); console.log("written", OUT); });
}

const read = (lab, f) => fs.readFileSync(path.join(lab, f), "utf8").replace(/\r/g, "");
const slice = (text, start, end) => { const a = text.indexOf(start); const b = text.indexOf(end, a); if (a < 0 || b < 0) throw new Error("not found: " + start); return text.slice(a, b + end.length); };
// Список источников: [номер в тексте] -> запись
function Sources(list) {
  return list.map((t, i) => new Paragraph({ style: "Source", tabStops: [{ type: TabStopType.LEFT, position: 1134 }], children: [run(`${i + 1}.\t${t}`)] }));
}
const SRC = {
  method: "Лабораторные работы и ДЗ по верификации. Этапы № 1 – № 3: методические указания [Электронный ресурс] // Репозиторий verification_lab, МГТУ им. Н.Э. Баумана, кафедра ИУ6. – URL: https://gitlab.bmstu.ru/iu6-hardware-section/verification_lab (дата обращения: 26.10.2026).",
  spec: "Спецификация модуля сдвига и округления мантисс чисел с плавающей точкой mant_shifter [Электронный ресурс] // Репозиторий verification_lab. – URL: https://gitlab.bmstu.ru/iu6-hardware-section/verification_lab (дата обращения: 26.10.2026).",
  sv: "IEEE Std 1800-2017. IEEE Standard for SystemVerilog – Unified Hardware Design, Specification, and Verification Language. – New York: IEEE, 2018. – 1315 p.",
  ieee754: "IEEE Std 754-2019. IEEE Standard for Floating-Point Arithmetic. – New York: IEEE, 2019. – 84 p.",
  round: "Floating-point numbers and rounding [Электронный ресурс]. – URL: https://drilian.com/posts/2023.01.10-floating-point-numbers-and-rounding/ (дата обращения: 26.10.2026).",
  gost: "ГОСТ 7.32-2017. Система стандартов по информации, библиотечному и издательскому делу. Отчет о научно-исследовательской работе. Структура и правила оформления. – М.: Стандартинформ, 2017. – 27 с.",
  verilator: "Verilator [Электронный ресурс]. – URL: https://verilator.org (дата обращения: 26.10.2026).",
  gtkwave: "GTKWave [Электронный ресурс] : программа просмотра временных диаграмм. – URL: https://gtkwave.sourceforge.net (дата обращения: 26.10.2026).",
};
module.exports = { NB, TW, PX, IND, FONT, MONO, AlignmentType, run, P, Li, H1, H2, Cap, Fig, Tbl, Lst, Sources, SRC, read, slice, build };
