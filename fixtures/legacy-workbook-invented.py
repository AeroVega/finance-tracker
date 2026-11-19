"""Minimal invented OOXML archive for converter tests; never uses a real workbook."""
import sys
from html import escape
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT = "http://schemas.openxmlformats.org/package/2006/content-types"
BOOK = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"


def text(cell, value):
    return f'<c r="{cell}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'


def numeric(cell, value):
    return f'<c r="{cell}"><v>{value}</v></c>'


def write(path, variant="ok"):
    names = ["Month", "Total income", "Total expenses", "Snapshot", "Saved cash flow",
             "Contract receipts", "Household expense", "Snapshot date"]
    header = "".join(text(chr(65 + i) + "1", value) for i, value in enumerate(names))
    col = '<cols><col min="4" max="4" hidden="1"/></cols>' if variant == "hidden-col" else ""
    merged = '<mergeCells count="1"><mergeCell ref="D2:E2"/></mergeCells>' if variant == "merge" else ""
    hidden = ' hidden="1"' if variant == "hidden-row" else ""
    month = numeric("A2", "44927") if variant == "serial" else '<c r="A2" t="s"><v>0</v></c>'
    expense = '<c r="C2"><f>123</f><v>123</v></c>' if variant == "formula" else (
        '<c r="C2" t="e"><v>#N/A</v></c>' if variant == "error-cell" else numeric("C2", "50.00")
    )
    worth = "" if variant == "required-blank" else numeric("D2", "12345678901234567890.000000000000000001")
    second = text("A4", "2023-01" if variant == "duplicate" else "2023-03") + numeric("B4", "0") + numeric("C4", "0.00")
    second += numeric("D4", "2.5000E+2") + numeric("E4", "1E-18") + numeric("G4", "0.00")
    history = [month, numeric("B2", "100.00"), expense, worth,
               text("F2", "0.10"), numeric("G2", "49.00" if variant == "total-mismatch" else "50.0"),
               text("H2", "2023-02-30" if variant == "invalid-date" else "2023-01-31")]
    if variant == "duplicate-cell":
        history.append(numeric("C2", "50.00"))
    if variant == "wrong-header":
        header = header.replace("Total expenses", "Different quantity")
    if variant == "array-spill":
        history[0] = '<c r="A2"><f t="array" ref="A2:B4">1</f><v>1</v></c>'
    if variant == "cell-metadata":
        history[1] = '<c r="B2" cm="1"><v>100.00</v></c>'
    formula_unmapped = '<c r="I2"><f>1+1</f><v>2</v></c>'
    xml = f'<worksheet xmlns="{NS}">{col}<sheetData><row r="1">{header}</row><row r="2"{hidden}>' + "".join(history)
    xml += formula_unmapped + f'</row><row r="4">{second}</row></sheetData>{merged}</worksheet>'
    if variant == "unsupported-xml":
        xml = "<!DOCTYPE worksheet []>" + xml
    work_rel = (' Target="https://example.invalid/monthly.xml" TargetMode="External"' if variant == "external"
                else ' Target="worksheets/sheet1.xml"')
    sheet_state = ' state="hidden"' if variant == "hidden-sheet" else ""
    entries = {
        "[Content_Types].xml": f'<Types xmlns="{CONTENT}"><Override PartName="/xl/workbook.xml" ContentType="{BOOK}"/></Types>',
        "_rels/.rels": f'<Relationships xmlns="{REL}"><Relationship Id="r" Type="{OFFICE}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<workbook xmlns="{NS}" xmlns:r="{OFFICE}"><sheets><sheet sheetId="1" name="Invented Monthly" r:id="r1"{sheet_state}/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": f'<Relationships xmlns="{REL}"><Relationship Id="r1" Type="{OFFICE}/worksheet"{work_rel}/><Relationship Id="r2" Type="{OFFICE}/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
        "xl/sharedStrings.xml": f'<sst xmlns="{NS}"><si><t>2023-01</t></si></sst>',
        "xl/worksheets/sheet1.xml": xml,
    }
    with ZipFile(path, "x") as archive:
        for filename, value in entries.items():
            entry = ZipInfo(filename, date_time=(2023, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            archive.writestr(entry, value)


if __name__ == "__main__":
    write(*sys.argv[1:])
