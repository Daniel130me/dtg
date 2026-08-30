import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPORT_MAX_ROWS,
  OWNER_MANAGEABLE_USER_STATUSES,
  OWNER_USER_NOT_FOUND,
  OWNER_USER_STATUS_FORBIDDEN,
} from "@/contracts/owner-ops";
import {
  evaluateUserStatusChange,
  USER_STATUS_AUDIT,
} from "@/server/modules/owner/students.logic";
import {
  ENROLMENT_EXPORT_HEADERS,
  STUDENT_EXPORT_HEADERS,
  enrolmentExportRows,
  exportDownloadFilename,
  exportExpiryFrom,
  isExportExpired,
  studentExportRows,
  toCsv,
} from "@/server/modules/owner/exports.logic";

// Pure owner-ops logic: the CSV wire format, export TTL/expiry decisions, the
// row mappers, and the user-status guard. The services turn these decisions
// into ApiErrors and rows — these tests pin the decisions themselves.

describe("CSV encoding", () => {
  it("passes plain cells through and prefixes the UTF-8 BOM", () => {
    const csv = toCsv(["id", "name"], [["1", "Ada"]]);
    assert.equal(csv, "\uFEFFid,name\r\n1,Ada");
    assert.equal(csv.codePointAt(0), 0xfeff);
  });

  it("quotes fields containing commas and doubles embedded quotes", () => {
    assert.equal(
      toCsv(["note"], [["He said \"hi\", loudly"]]),
      `\uFEFFnote\r\n"He said ""hi"", loudly"`,
    );
  });

  it("quotes fields containing newlines and CR (line endings stay intact)", () => {
    assert.equal(toCsv(["note"], [["line1\nline2"]]), `\uFEFFnote\r\n"line1\nline2"`);
    assert.equal(toCsv(["note"], [["a\r\nb"]]), `\uFEFFnote\r\n"a\r\nb"`);
  });

  it("renders null as an empty cell and numbers as plain digits", () => {
    assert.equal(toCsv(["a", "b", "c"], [[null, 42, "x"]]), "\uFEFFa,b,c\r\n,42,x");
  });

  it("produces one CRLF-joined record per row (headers + data)", () => {
    const csv = toCsv(["a", "b"], [["1", "2"], ["3", "4"]]);
    assert.equal(csv, "\uFEFFa,b\r\n1,2\r\n3,4");
  });
});

describe("export expiry", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");

  it("keeps a COMPLETED job live before its expiry instant", () => {
    assert.equal(
      isExportExpired(
        { status: "COMPLETED", expiresAt: new Date("2026-01-16T11:59:59.000Z") },
        now,
      ),
      false,
    );
  });

  it("expires exactly at the expiry instant (boundary inclusive)", () => {
    assert.equal(
      isExportExpired(
        { status: "COMPLETED", expiresAt: new Date("2026-01-15T12:00:00.000Z") },
        now,
      ),
      true,
    );
  });

  it("expires a COMPLETED job after its expiry instant", () => {
    assert.equal(
      isExportExpired(
        { status: "COMPLETED", expiresAt: new Date("2026-01-15T11:59:59.000Z") },
        now,
      ),
      true,
    );
  });

  it("treats an EXPIRED row as expired regardless of its metadata", () => {
    assert.equal(isExportExpired({ status: "EXPIRED", expiresAt: null }, now), true);
  });

  it("never expires jobs without a file or a recorded TTL", () => {
    for (const status of ["PENDING", "PROCESSING", "FAILED"]) {
      assert.equal(
        isExportExpired({ status, expiresAt: new Date("2020-01-01T00:00:00.000Z") }, now),
        false,
      );
    }
    assert.equal(isExportExpired({ status: "COMPLETED", expiresAt: null }, now), false);
  });
});

describe("export TTL math and filename", () => {
  it("stamps expiry exactly EXPORT_TTL_HOURS after completion", () => {
    const completedAt = new Date("2026-01-15T10:30:00.000Z");
    assert.equal(exportExpiryFrom(completedAt).toISOString(), "2026-01-16T10:30:00.000Z");
  });

  it("builds the dtg-<type>-<yyyy-mm-dd>.csv filename from the completion date", () => {
    assert.equal(
      exportDownloadFilename("ENROLMENTS", "2026-01-15T10:00:00.000Z"),
      "dtg-enrolments-2026-01-15.csv",
    );
    assert.equal(
      exportDownloadFilename("STUDENTS", "2026-12-31T23:59:59.999Z"),
      "dtg-students-2026-12-31.csv",
    );
  });

  it("keeps the row-cap constant aligned with the metrics doc", () => {
    assert.equal(EXPORT_MAX_ROWS, 5_000);
  });
});

describe("export row mappers", () => {
  const enrolledAt = new Date("2026-01-05T08:00:00.000Z");
  const completedAt = new Date("2026-01-10T09:30:00.000Z");

  it("maps an enrolment row with ISO dates, labels, and null completions", () => {
    const [cells] = enrolmentExportRows([
      {
        id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
        userId: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
        courseId: "3f2504e0-4f89-11d3-9a0c-0305e82c3303",
        learnerName: "Ada Lovelace",
        learnerEmail: "ada@example.com",
        courseTitle: "React Basics",
        status: "COMPLETED",
        source: "PURCHASE",
        enrolledAt,
        completedAt,
        lastActivityAt: null,
      },
    ]);
    assert.deepEqual(cells, [
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "Ada Lovelace",
      "ada@example.com",
      "React Basics",
      "COMPLETED",
      "PURCHASE",
      "2026-01-05T08:00:00.000Z",
      "2026-01-10T09:30:00.000Z",
      null,
    ]);
    assert.equal(cells?.length, ENROLMENT_EXPORT_HEADERS.length);
  });

  it("maps a student row with the account fields and null last activity", () => {
    const [cells] = studentExportRows([
      {
        id: "3f2504e0-4f89-11d3-9a0c-0305e82c3304",
        name: "Grace Hopper",
        email: "grace@example.com",
        status: "SUSPENDED",
        createdAt: enrolledAt,
        enrolmentCount: 3,
        lastActivityAt: null,
      },
    ]);
    assert.deepEqual(cells, [
      "3f2504e0-4f89-11d3-9a0c-0305e82c3304",
      "Grace Hopper",
      "grace@example.com",
      "SUSPENDED",
      "2026-01-05T08:00:00.000Z",
      3,
      null,
    ]);
    assert.equal(cells?.length, STUDENT_EXPORT_HEADERS.length);
  });

  it("emits rows as wide as their headers for both export types", () => {
    const enrolmentRow = enrolmentExportRows([
      {
        id: "a", userId: "b", courseId: "c", learnerName: "n", learnerEmail: "e",
        courseTitle: "t", status: "ACTIVE", source: "FREE", enrolledAt,
        completedAt: null, lastActivityAt: completedAt,
      },
    ])[0];
    const studentRow = studentExportRows([
      {
        id: "a", name: "n", email: "e", status: "ACTIVE", createdAt: enrolledAt,
        enrolmentCount: 0, lastActivityAt: null,
      },
    ])[0];
    assert.equal(enrolmentRow?.length, ENROLMENT_EXPORT_HEADERS.length);
    assert.equal(studentRow?.length, STUDENT_EXPORT_HEADERS.length);
  });
});

describe("user status guard", () => {
  const actorId = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

  it("refuses self-targets with OWNER_USER_STATUS_FORBIDDEN", () => {
    assert.deepEqual(
      evaluateUserStatusChange(actorId, { id: actorId, role: "STUDENT", status: "ACTIVE" }, "SUSPENDED"),
      { ok: false, code: OWNER_USER_STATUS_FORBIDDEN },
    );
  });

  it("refuses OWNER-role targets even when they are not the caller", () => {
    assert.deepEqual(
      evaluateUserStatusChange(
        actorId,
        { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302", role: "OWNER", status: "ACTIVE" },
        "SUSPENDED",
      ),
      { ok: false, code: OWNER_USER_STATUS_FORBIDDEN },
    );
  });

  it("reads DELETED targets as absent (never restorable)", () => {
    assert.deepEqual(
      evaluateUserStatusChange(
        actorId,
        { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302", role: "STUDENT", status: "DELETED" },
        "ACTIVE",
      ),
      { ok: false, code: OWNER_USER_NOT_FOUND },
    );
  });

  it("marks same-status repeats as allowed no-ops", () => {
    assert.deepEqual(
      evaluateUserStatusChange(
        actorId,
        { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302", role: "STUDENT", status: "ACTIVE" },
        "ACTIVE",
      ),
      { ok: true, noop: true },
    );
    assert.deepEqual(
      evaluateUserStatusChange(
        actorId,
        { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302", role: "STUDENT", status: "SUSPENDED" },
        "SUSPENDED",
      ),
      { ok: true, noop: true },
    );
  });

  it("allows real transitions in both directions", () => {
    const target = { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302", role: "STUDENT" as const, status: "ACTIVE" as const };
    assert.deepEqual(evaluateUserStatusChange(actorId, target, "SUSPENDED"), { ok: true, noop: false });
    assert.deepEqual(
      evaluateUserStatusChange(actorId, { ...target, status: "SUSPENDED" }, "ACTIVE"),
      { ok: true, noop: false },
    );
  });

  it("only ever offers the two manageable statuses", () => {
    assert.deepEqual(OWNER_MANAGEABLE_USER_STATUSES, ["ACTIVE", "SUSPENDED"]);
  });

  it("keeps the user-status audit action vocabulary stable", () => {
    assert.deepEqual(USER_STATUS_AUDIT, {
      suspended: "user.suspended",
      reactivated: "user.reactivated",
    });
  });
});
