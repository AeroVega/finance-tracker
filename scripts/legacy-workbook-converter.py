#!/usr/bin/env python3
"""Convert one explicitly mapped, saved values-only .xlsx history worksheet."""
import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import tempfile
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET

CONVERTER_VERSION = "1.0.0"
MAX_INPUT = 16 * 1024 * 1024
MAX_XML = 8 * 1024 * 1024
MAX_OUTPUT = 1024 * 1024
MAX_ROWS = 600
MAX_FINDINGS = 200
INVALID = object()
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT = "http://schemas.openxmlformats.org/package/2006/content-types"
MONTH = re.compile(r"(?!0000)[0-9]{4}-(?:0[1-9]|1[0-2])")
COLUMN = re.compile(r"[A-Z]{1,3}")
CELL = re.compile(r"([A-Z]{1,3})([1-9][0-9]{0,6})")
DECIMAL = re.compile(r"-?(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,18})?")
NUMERIC = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]{1,3})?")
MONEY = ("incomeTotal", "expenseTotal", "netWorthSnapshot", "netCashFlow")
BREAKDOWNS = ("incomeSources", "expenseCategories")


class Findings(list):
    def __init__(self):
        super().__init__()
        self.errors = 0
        self.warnings = 0

    def append(self, finding):
        if finding["severity"] == "error":
            self.errors += 1
        else:
            self.warnings += 1
        if len(self) < MAX_FINDINGS:
            super().append(finding)


class ConversionError(Exception):
    def __init__(self, code, **location):
        super().__init__(code)
        self.finding = {"severity": "error", "code": code, **location}


def fail(code, **location):
    raise ConversionError(code, **location)


def tag(name):
    return f"{{{NS}}}{name}"


def field_shape(value, required=(), optional=()):
    return type(value) is dict and set(required) <= value.keys() <= set(required) | set(optional)


def literal(value, limit=500):
    return isinstance(value, str) and 0 < len(value) <= limit and bool(value.strip()) and not any(
        ord(ch) < 32 or 0xD800 <= ord(ch) <= 0xDFFF for ch in value
    )


def col_number(value):
    number = 0
    for ch in value:
        number = number * 26 + ord(ch) - ord("A") + 1
    return number


def month_number(value):
    if not isinstance(value, str) or not MONTH.fullmatch(value):
        fail("invalid-expected-month")
    return int(value[:4]) * 12 + int(value[5:]) - 1


def month_string(n):
    return f"{n // 12:04d}-{n % 12 + 1:02d}"


def require_shape(value, required=(), optional=()):
    if not field_shape(value, required, optional):
        fail("invalid-mapping")


def load_mapping(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail("duplicate-mapping-key")
            result[key] = value
        return result

    try:
        m = json.loads(raw.decode("utf-8"), object_pairs_hook=unique)
    except (UnicodeDecodeError, ValueError, RecursionError):
        fail("invalid-mapping-json")
    require_shape(m, ("format", "version", "worksheet", "rows", "expectedMonthRange",
                      "source", "scope", "month", "summary"), ("breakdowns", "snapshotDate"))
    if m["format"] != "finance-tracker-legacy-workbook-map" or type(m["version"]) is not int or m["version"] != 1:
        fail("unsupported-mapping-format")
    if not literal(m["worksheet"], 31):
        fail("invalid-mapping")
    require_shape(m["source"], ("workbook", "sourceId", "mappingVersion"), ("workbookSha256",))
    if not all(literal(value) for value in m["source"].values()):
        fail("invalid-mapping")
    if "workbookSha256" in m["source"] and not re.fullmatch(r"[a-f0-9]{64}", m["source"]["workbookSha256"]):
        fail("invalid-workbook-hash-binding")
    require_shape(m["scope"], ("kind",))
    if m["scope"]["kind"] not in ("aggregate", "unknown"):
        fail("unsupported-mapping-scope")
    require_shape(m["rows"], ("header", "first", "last"))
    header, first, last = (m["rows"][k] for k in ("header", "first", "last"))
    if not all(type(n) is int for n in (header, first, last)) or not (1 <= header < first <= last <= 1048576) or last - first >= MAX_ROWS:
        fail("invalid-mapped-row-band")
    require_shape(m["expectedMonthRange"], ("start", "end"))
    start, end = (month_number(m["expectedMonthRange"][key]) for key in ("start", "end"))
    if end < start or end - start >= MAX_ROWS:
        fail("invalid-expected-month")
    require_shape(m["summary"], MONEY[:3], MONEY[3:])
    require_shape(m.get("breakdowns", {}), optional=BREAKDOWNS)
    columns = {}

    def add(spec, money=False, labeled=False):
        require_shape(spec, ("column", "header") + (("currency",) if money else ()) + (("label",) if labeled else ()))
        column = spec["column"]
        if not isinstance(column, str) or not COLUMN.fullmatch(column) or col_number(column) > 16384:
            fail("invalid-mapped-column")
        if column in columns:
            fail("duplicate-mapped-column")
        if not literal(spec["header"]):
            fail("invalid-mapping")
        if money and (not isinstance(spec["currency"], str) or not re.fullmatch(r"[A-Z]{3}", spec["currency"])):
            fail("invalid-mapped-currency")
        if labeled and not literal(spec["label"]):
            fail("invalid-mapping")
        columns[column] = spec["header"]

    add(m["month"])
    if "snapshotDate" in m:
        add(m["snapshotDate"])
    for field in MONEY:
        if field in m["summary"]:
            add(m["summary"][field], money=True)
    for field in BREAKDOWNS:
        if field not in m.get("breakdowns", {}):
            continue
        group = m["breakdowns"][field]
        require_shape(group, ("complete", "items"))
        if type(group["complete"]) is not bool or type(group["items"]) is not list or not (1 <= len(group["items"]) <= 200):
            fail("invalid-breakdown-mapping")
        labels = set()
        for spec in group["items"]:
            add(spec, money=True, labeled=True)
            if spec["label"] in labels:
                fail("duplicate-breakdown-label")
            labels.add(spec["label"])
    return m, columns, start, end


def read_limited(path, limit, code):
    try:
        with path.open("rb") as stream:
            raw = stream.read(limit + 1)
    except OSError:
        fail(code)
    if len(raw) > limit:
        fail("input-size-limit")
    return raw


class Workbook:
    """Recognize the standard XML parts we need; do not extract or execute anything."""

    def __init__(self, archive):
        self.archive = archive
        entries = archive.infolist()
        if len(entries) > 1024 or len({entry.filename for entry in entries}) != len(entries):
            fail("unsupported-workbook-archive")
        if any(entry.flag_bits & 1 or "\\" in entry.filename or entry.filename.startswith("/") or
               ".." in PurePosixPath(entry.filename).parts for entry in entries):
            fail("unsupported-workbook-archive")
        content = self.xml("[Content_Types].xml")
        root_rel = self.xml("_rels/.rels")
        packages = [node for node in root_rel.findall(f"{{{REL}}}Relationship")
                    if node.get("Type") == f"{OFFICE}/officeDocument"]
        if (root_rel.tag != f"{{{REL}}}Relationships" or len(packages) != 1 or
                packages[0].get("Target") not in ("xl/workbook.xml", "/xl/workbook.xml") or
                packages[0].get("TargetMode", "Internal") != "Internal"):
            fail("unsupported-workbook-format")
        overrides = [node.get("ContentType") for node in content.findall(f"{{{CONTENT}}}Override")
                     if node.get("PartName") == "/xl/workbook.xml"]
        defaults = [node.get("ContentType") for node in content.findall(f"{{{CONTENT}}}Default")
                    if node.get("Extension", "").lower() == "xml"]
        if (content.tag != f"{{{CONTENT}}}Types" or
                (overrides or defaults) != ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"] or
                any(entry.filename.lower().endswith("vbaproject.bin") for entry in entries)):
            fail("unsupported-workbook-format")
        self.book = self.xml("xl/workbook.xml")
        if self.book.tag != tag("workbook"):
            fail("unsupported-workbook-format")
        relations = self.xml("xl/_rels/workbook.xml.rels")
        if relations.tag != f"{{{REL}}}Relationships":
            fail("invalid-workbook-relationships")
        self.relations = {}
        for node in relations.findall(f"{{{REL}}}Relationship"):
            ident = node.get("Id")
            if not ident or ident in self.relations:
                fail("invalid-workbook-relationships")
            self.relations[ident] = node
        self.strings = None

    def xml(self, name):
        try:
            info = self.archive.getinfo(name)
            if info.file_size > MAX_XML:
                fail("workbook-part-size-limit")
            with self.archive.open(info) as stream:
                raw = stream.read(MAX_XML + 1)
            if len(raw) > MAX_XML:
                fail("workbook-part-size-limit")
            text = raw.decode("utf-8-sig")
            if "\x00" in text or re.search(r"<!\s*(?:DOCTYPE|ENTITY)", text, re.IGNORECASE):
                fail("unsupported-workbook-xml")
            return ET.fromstring(text)
        except (ET.ParseError, UnicodeError, zipfile.BadZipFile, RuntimeError, KeyError, NotImplementedError, OSError):
            fail("invalid-workbook-part")

    def target(self, relation, kind):
        if relation is None or relation.get("Type") != f"{OFFICE}/{kind}" or relation.get("TargetMode", "Internal") != "Internal":
            fail("unsupported-workbook-relationship")
        target = relation.get("Target", "")
        if target.startswith("/xl/"):
            target = target[1:]
        else:
            target = "xl/" + target
        pattern = r"xl/worksheets/[A-Za-z0-9_.-]+\.xml" if kind == "worksheet" else r"xl/[A-Za-z0-9_.-]+\.xml"
        if not re.fullmatch(pattern, target):
            fail("unsupported-workbook-relationship")
        return target

    def shared_string(self, index, coordinate):
        if not re.fullmatch(r"(?:0|[1-9][0-9]{0,7})", index or ""):
            fail("invalid-shared-string", cell=coordinate)
        if self.strings is None:
            matches = [item for item in self.relations.values() if item.get("Type") == f"{OFFICE}/sharedStrings"]
            if len(matches) != 1:
                fail("invalid-shared-string", cell=coordinate)
            root = self.xml(self.target(matches[0], "sharedStrings"))
            if root.tag != tag("sst"):
                fail("invalid-shared-string", cell=coordinate)
            self.strings = root.findall(tag("si"))
        position = int(index)
        if position >= len(self.strings):
            fail("invalid-shared-string", cell=coordinate)
        return self.text(self.strings[position], coordinate)

    @staticmethod
    def text(node, coordinate):
        parts = list(node)
        if len(parts) == 1 and parts[0].tag == tag("t") and not len(parts[0]):
            return parts[0].text or ""
        # For display formatting, respect the order of regular rich-text runs.
        if parts and all(part.tag == tag("r") for part in parts):
            tokens = []
            for part in parts:
                nodes = list(part)
                if [child.tag for child in nodes] not in ([tag("t")], [tag("rPr"), tag("t")]) or len(nodes[-1]):
                    fail("unsupported-cell-text", cell=coordinate)
                tokens.append(nodes[-1].text or "")
            return "".join(tokens)
        if not parts:
            return ""
        fail("unsupported-cell-text", cell=coordinate)

    def sheet(self, worksheet, selected_rows, columns):
        sheets = self.book.findall(tag("sheets"))
        if len(sheets) != 1:
            fail("unsupported-workbook-format")
        matches = [node for node in sheets[0].findall(tag("sheet")) if node.get("name") == worksheet]
        if len(matches) != 1:
            fail("worksheet-not-unique")
        chosen = matches[0]
        if chosen.get("state", "visible") != "visible":
            fail("worksheet-not-visible")
        tree = self.xml(self.target(self.relations.get(chosen.get(f"{{{OFFICE}}}id")), "worksheet"))
        data = tree.find(tag("sheetData"))
        if tree.tag != tag("worksheet") or data is None or len(tree.findall(tag("sheetData"))) != 1:
            fail("unsupported-worksheet-structure")
        col_ids = {col_number(column) for column in columns}
        for col in tree.findall(f"{tag('cols')}/{tag('col')}"):
            if col.get("hidden", "0") not in ("0", "false"):
                lo, hi = (col.get(key, "") for key in ("min", "max"))
                if not all(re.fullmatch(r"[1-9][0-9]{0,4}", s) for s in (lo, hi)):
                    fail("unsupported-worksheet-structure")
                if not (1 <= int(lo) <= int(hi) <= 16384):
                    fail("unsupported-worksheet-structure")
                if any(int(lo) <= number <= int(hi) for number in col_ids):
                    fail("mapped-column-hidden")
        def intersects_selected(ref):
            parts = ref.split(":")
            if len(parts) == 1:
                parts.append(parts[0])
            if len(parts) != 2 or any(not CELL.fullmatch(part) for part in parts):
                fail("unsupported-worksheet-structure")
            start, end = (CELL.fullmatch(part) for part in parts)
            lo, hi, top, bottom = col_number(start[1]), col_number(end[1]), int(start[2]), int(end[2])
            if not (1 <= lo <= hi <= 16384 and 1 <= top <= bottom <= 1048576):
                fail("unsupported-worksheet-structure")
            return any(lo <= n <= hi for n in col_ids) and any(top <= n <= bottom for n in selected_rows)

        for merged in tree.findall(f"{tag('mergeCells')}/{tag('mergeCell')}"):
            if intersects_selected(merged.get("ref", "")):
                fail("mapped-range-contains-merged-cells")

        # Array/data-table/shared formulas can cover cells whose own XML looks
        # like a saved number. Check declared formula extents even when the
        # formula's anchor is outside the mapped row/column set.
        for holder in data.findall(f"{tag('row')}/{tag('c')}"):
            for formula in holder.findall(tag("f")):
                ref = formula.get("ref")
                if ref is not None and intersects_selected(ref):
                    coord = holder.get("r", "")
                    details = {"range": ref}
                    if CELL.fullmatch(coord):
                        details["cell"] = coord
                    fail("formula-range-not-admitted", **details)
        cells, seen_rows = {}, set()
        for row in data.findall(tag("row")):
            row_id = row.get("r", "")
            if not re.fullmatch(r"[1-9][0-9]{0,6}", row_id):
                fail("unsupported-worksheet-structure")
            number = int(row_id)
            if number not in selected_rows:
                continue
            if number in seen_rows:
                fail("duplicate-mapped-row", row=number)
            seen_rows.add(number)
            if row.get("hidden", "0") not in ("0", "false"):
                fail("mapped-row-hidden", row=number)
            for cell in row.findall(tag("c")):
                coord = cell.get("r", "")
                match = CELL.fullmatch(coord)
                if not match or match[2] != row_id:
                    fail("invalid-mapped-cell-coordinate", row=number)
                if match[1] not in columns:
                    continue
                if coord in cells:
                    fail("duplicate-mapped-cell", cell=coord)
                cells[coord] = cell
        return cells

    def value(self, cell, coordinate):
        if cell is None:
            return None
        if cell.find(tag("f")) is not None:
            fail("formula-cell-not-admitted", cell=coordinate)
        if cell.get("cm") is not None or cell.get("vm") is not None:
            fail("unsupported-cell-metadata", cell=coordinate)
        values, inline = cell.findall(tag("v")), cell.findall(tag("is"))
        if len(cell) != len(values) + len(inline) or any(len(value) for value in values):
            fail("unsupported-cell-type", cell=coordinate)
        if len(values) > 1 or len(inline) > 1 or (values and inline):
            fail("ambiguous-cell-value", cell=coordinate)
        kind = cell.get("t", "n")
        token = values[0].text if values else None
        if kind == "inlineStr" and not values:
            text = self.text(inline[0], coordinate) if inline else ""
            return ("text", text) if text else None
        if inline:
            fail("unsupported-cell-type", cell=coordinate)
        if kind == "s":
            text = self.shared_string(token, coordinate)
            return ("text", text) if text else None
        if kind == "n":
            return ("number", token) if token is not None else None
        if kind == "e":
            fail("worksheet-error-cell", cell=coordinate)
        fail("unsupported-cell-type", cell=coordinate)


def decimal_from(cell, coordinate):
    kind, token = cell
    if kind == "text" and DECIMAL.fullmatch(token):
        return token
    if kind == "number" and len(token) <= 80 and NUMERIC.fullmatch(token):
        amount = Decimal(token)
        if -18 <= amount.as_tuple().exponent <= 29 and amount.adjusted() <= 29:
            exact = format(amount, "f")
            if DECIMAL.fullmatch(exact):
                return exact
    fail("unsupported-exact-decimal", cell=coordinate)


def valid_date(value):
    if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        try:
            date.fromisoformat(value)
            return True
        except ValueError:
            pass
    return False


def extract(workbook, mapping, columns, start, end, findings):
    header, first, last = (mapping["rows"][k] for k in ("header", "first", "last"))
    selected_rows = {header, *range(first, last + 1)}
    cells = workbook.sheet(mapping["worksheet"], selected_rows, columns)

    def read(coordinate):
        try:
            return workbook.value(cells.get(coordinate), coordinate)
        except ConversionError as error:
            findings.append(error.finding)
            return INVALID

    for column, expected in columns.items():
        coord = column + str(header)
        observed = read(coord)
        if observed is not INVALID and observed != ("text", expected):
            findings.append({"severity": "error", "code": "mapped-header-mismatch", "cell": coord})
    if findings:
        return []
    low, high = min(columns, key=col_number), max(columns, key=col_number)
    records, prior = [], {}
    for row in range(first, last + 1):
        coords = {col: col + str(row) for col in columns}
        values = {col: read(coord) for col, coord in coords.items()}
        if not any(value is not None for value in values.values()):
            continue
        month_col = mapping["month"]["column"]
        period = values[month_col]
        if period is INVALID:
            continue
        if period is None or period[0] != "text" or not MONTH.fullmatch(period[1]):
            findings.append({"severity": "error", "code": "missing-or-invalid-month", "cell": coords[month_col]})
            continue
        label = period[1]
        number = month_number(label)
        if not start <= number <= end:
            findings.append({"severity": "error", "code": "month-outside-expected-range", "cell": coords[month_col], "month": label})
        if label in prior:
            findings.append({"severity": "error", "code": "duplicate-workbook-month", "cell": coords[month_col], "otherCell": prior[label], "month": label})
        else:
            prior[label] = coords[month_col]

        def money(spec, *, required):
            col = spec["column"]
            coord = coords[col]
            value = values[col]
            if value is INVALID:
                return None
            if value is None:
                findings.append({"severity": "error" if required else "warning",
                                 "code": "required-amount-unavailable" if required else "optional-amount-unavailable", "cell": coord})
                return None
            try:
                return {"amount": decimal_from(value, coord), "currency": spec["currency"]}
            except ConversionError as error:
                findings.append(error.finding)
                return None

        summary, breakdowns, locations, ranges = {}, {}, {}, {}
        for field in MONEY:
            spec = mapping["summary"].get(field)
            if spec is not None:
                locations[field] = coords[spec["column"]]
                amount = money(spec, required=field != "netCashFlow")
                if amount is not None:
                    summary[field] = amount
        for field in BREAKDOWNS:
            group = mapping.get("breakdowns", {}).get(field)
            if group is None:
                continue
            group_columns = sorted((item["column"] for item in group["items"]), key=col_number)
            ranges[field] = coords[group_columns[0]] + ":" + coords[group_columns[-1]]
            items = []
            for spec in group["items"]:
                amount = money(spec, required=group["complete"])
                if amount is not None:
                    items.append({"label": spec["label"], "amount": amount})
            breakdowns[field] = {"complete": group["complete"], "items": items}

        src = mapping["source"]
        provenance = {
            "workbook": src["workbook"], "sourceId": src["sourceId"],
            "worksheet": mapping["worksheet"], "mapping": src["mappingVersion"],
            "converterVersion": CONVERTER_VERSION, "cell": coords[month_col],
            "range": coords[low] + ":" + coords[high], "cells": locations,
        }
        if ranges:
            provenance["ranges"] = ranges
        if "snapshotDate" in mapping:
            col = mapping["snapshotDate"]["column"]
            value = values[col]
            if value is not None and value is not INVALID:
                if value[0] != "text" or not valid_date(value[1]):
                    findings.append({"severity": "error", "code": "invalid-snapshot-date", "cell": coords[col]})
                else:
                    provenance["snapshotAsOf"] = value[1]
        record = {"month": label, "summary": summary, "provenance": provenance, "scope": mapping["scope"]}
        if breakdowns:
            record["breakdowns"] = breakdowns
        records.append(record)
    return records


def validate_with_app(raw, findings, records):
    script = Path(__file__).with_name("legacy-workbook-admission.mjs")
    try:
        result = subprocess.run(["node", str(script)], input=raw, capture_output=True, timeout=30, check=False)
        if result.returncode:
            fail("app-admission-unavailable")
        checked = json.loads(result.stdout)
        if type(checked.get("accepted")) is not bool or type(checked.get("findings")) is not list:
            fail("app-admission-unavailable")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        fail("app-admission-unavailable")
    for item in checked["findings"]:
        issue = {"severity": "error", "code": "app-" + item["code"]}
        index = item.get("recordIndex")
        if type(index) is int and 0 <= index < len(records):
            provenance = records[index]["provenance"]
            field = item.get("field")
            if field in provenance.get("ranges", {}):
                issue["range"] = provenance["ranges"][field]
            else:
                issue["cell"] = provenance["cells"].get(field, provenance["cell"])
        findings.append(issue)
    if not checked["accepted"] and not checked["findings"]:
        fail("app-admission-rejected")
    return checked["accepted"]


def write_new(path, raw):
    # A same-directory temporary file and no-overwrite link: a failed conversion
    # never replaces source, mapping, or an existing output.
    temp = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".legacy-monthly-", delete=False) as stream:
            temp = Path(stream.name)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temp, path)
    except FileExistsError:
        fail("output-already-exists")
    except OSError:
        fail("output-write-failed")
    finally:
        if temp is not None:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path, help="A separate, locally reviewed .xlsx file")
    parser.add_argument("--mapping", required=True, type=Path, help="Explicit local mapping JSON")
    parser.add_argument("--output", type=Path, help="Create new normalized JSON only if admitted; omit for report-only dry run")
    args = parser.parse_args()
    findings = Findings()
    report = {"format": "finance-tracker-legacy-workbook-report", "version": 1, "converterVersion": CONVERTER_VERSION,
              "status": "blocked", "outputWritten": False, "appAdmission": "not-run", "findings": findings}
    try:
        if args.output is not None and args.output.suffix.lower() != ".json":
            fail("unsupported-output-format")
        if args.workbook.suffix.lower() != ".xlsx":
            fail("unsupported-workbook-format")
        mapping, columns, start, end = load_mapping(read_limited(args.mapping, MAX_OUTPUT, "mapping-read-failed"))
        raw = read_limited(args.workbook, MAX_INPUT, "workbook-read-failed")
        report["workbookSha256"] = hashlib.sha256(raw).hexdigest()
        if mapping["source"].get("workbookSha256", report["workbookSha256"]) != report["workbookSha256"]:
            fail("workbook-hash-binding-mismatch")
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                records = extract(Workbook(archive), mapping, columns, start, end, findings)
        except (zipfile.BadZipFile, ValueError, OverflowError):
            fail("unsupported-workbook-archive")
        labels = {record["month"] for record in records}
        report["recordCount"] = len(records)
        report["missingMonths"] = [month_string(n) for n in range(start, end + 1) if month_string(n) not in labels]
        if not records and not findings:
            fail("no-monthly-records")
        if not findings.errors:
            result = {"format": "finance-tracker-historical-monthly-summaries", "version": 1,
                      "expectedMonthRange": mapping["expectedMonthRange"], "records": records}
            normalized = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            if len(normalized) > MAX_OUTPUT:
                fail("normalized-output-size-limit")
            report["appAdmission"] = "passed" if validate_with_app(normalized, findings, records) else "rejected"
            if report["appAdmission"] == "passed":
                if args.output is not None:
                    write_new(args.output, normalized)
                    report["outputWritten"] = True
                report["status"] = "ready-for-review"
    except ConversionError as error:
        findings.append(error.finding)
    report["errorCount"] = findings.errors
    report["warningCount"] = findings.warnings
    report["omittedFindingCount"] = findings.errors + findings.warnings - len(findings)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if report["status"] == "ready-for-review" else 2


if __name__ == "__main__":
    raise SystemExit(main())
