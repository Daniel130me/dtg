import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gradingQueueQuerySchema,
  quizAttemptResultSchema,
  quizAuthoringInputSchema,
  quizLearnerViewSchema,
  quizSubmitSchema,
} from "@/contracts/assessments";
import {
  buildAttemptResultQuestions,
  buildQuestionSnapshot,
  canStartQuizAttempt,
  attemptsRemaining,
  computeSubmitDeadline,
  deriveQuizAttemptState,
  deriveQuizOutcome,
  evaluateSubmissionEligibility,
  isGradeScoreInRange,
  isSubmitDeadlinePassed,
  resolveSnapshotAnswers,
  sanitizeQuizQuestions,
  scoreResolvedAnswers,
  toQuizAnswerRows,
  type AttemptStateRow,
  type QuizSnapshotQuestion,
} from "@/server/modules/assessments/assessments.logic";

// Two-question fixture: q1 (2 points, answer A) and q2 (3 points, answer D).
function makeSnapshot(): QuizSnapshotQuestion[] {
  return [
    {
      questionId: "q1",
      position: 0,
      prompt: "Which one is A?",
      points: 2,
      explanation: "A is the first letter.",
      options: [
        { id: "o1", position: 0, text: "A", isCorrect: true },
        { id: "o2", position: 1, text: "B", isCorrect: false },
      ],
    },
    {
      questionId: "q2",
      position: 1,
      prompt: "Which one is D?",
      points: 3,
      explanation: null,
      options: [
        { id: "o3", position: 0, text: "C", isCorrect: false },
        { id: "o4", position: 1, text: "D", isCorrect: true },
      ],
    },
  ];
}

describe("snapshot building and sanitization", () => {
  it("freezes prompt, points, explanation and the answer key", () => {
    const liveRows = [
      {
        id: "q1",
        position: 0,
        prompt: "Which one is A?",
        points: 2,
        explanation: "A is the first letter.",
        options: [
          { id: "o1", position: 0, text: "A", isCorrect: true },
          { id: "o2", position: 1, text: "B", isCorrect: false },
        ],
      },
    ];
    const snapshot = buildQuestionSnapshot(liveRows);
    assert.equal(snapshot[0].questionId, "q1");
    assert.equal(snapshot[0].options[0].isCorrect, true);
  });

  it("strips isCorrect and explanation for the pre-submission view", () => {
    const [sanitized] = sanitizeQuizQuestions(makeSnapshot());
    assert.equal("explanation" in sanitized, false);
    assert.deepEqual(sanitized, {
      id: "q1",
      position: 0,
      prompt: "Which one is A?",
      points: 2,
      options: [
        { id: "o1", position: 0, text: "A" },
        { id: "o2", position: 1, text: "B" },
      ],
    });
    for (const question of sanitizeQuizQuestions(makeSnapshot())) {
      for (const option of question.options) {
        assert.equal("isCorrect" in option, false);
      }
    }
  });
});

describe("scoring from the snapshot", () => {
  it("marks correct selections, wrong selections and unanswered questions", () => {
    const resolved = resolveSnapshotAnswers(makeSnapshot(), [
      { questionId: "q1", optionId: "o1" },
      { questionId: "q2", optionId: "o3" },
      { questionId: "ghost", optionId: "o1" },
    ]);
    assert.deepEqual(resolved, [
      { questionId: "q1", optionId: "o1", isCorrect: true },
      { questionId: "q2", optionId: "o3", isCorrect: false },
    ]);
  });

  it("treats a missing answer or a null option as unanswered", () => {
    const resolved = resolveSnapshotAnswers(makeSnapshot(), [
      { questionId: "q2", optionId: null },
    ]);
    assert.deepEqual(resolved, [
      { questionId: "q1", optionId: null, isCorrect: false },
      { questionId: "q2", optionId: null, isCorrect: false },
    ]);
  });

  it("ignores an option id the snapshot does not know", () => {
    const resolved = resolveSnapshotAnswers(makeSnapshot(), [
      { questionId: "q1", optionId: "smuggled-option" },
    ]);
    assert.equal(resolved[0].isCorrect, false);
    assert.equal(resolved[0].optionId, null);
  });

  it("sums earned and maximum points, with unanswered worth zero", () => {
    const snapshot = makeSnapshot();
    const allRight = resolveSnapshotAnswers(snapshot, [
      { questionId: "q1", optionId: "o1" },
      { questionId: "q2", optionId: "o4" },
    ]);
    assert.deepEqual(scoreResolvedAnswers(snapshot, allRight), { scorePoints: 5, maxPoints: 5 });

    const partial = resolveSnapshotAnswers(snapshot, [{ questionId: "q1", optionId: "o1" }]);
    assert.deepEqual(scoreResolvedAnswers(snapshot, partial), { scorePoints: 2, maxPoints: 5 });

    assert.deepEqual(scoreResolvedAnswers(snapshot, []), { scorePoints: 0, maxPoints: 5 });
  });

  it("floors the percentage and compares it against the pass mark", () => {
    // 2/5 = 40%
    assert.deepEqual(deriveQuizOutcome(2, 5, 70), {
      scorePoints: 2,
      maxPoints: 5,
      scorePercent: 40,
      passed: false,
    });
    // Boundary: exactly the pass mark passes (floored 70 >= 70).
    assert.equal(deriveQuizOutcome(70, 100, 70).passed, true);
    // Rounding never rounds up to a pass: 69.99 floors to 69.
    assert.equal(deriveQuizOutcome(699, 1000, 70).passed, false);
    assert.equal(deriveQuizOutcome(0, 5, 70).scorePercent, 0);
  });

  it("freezes the verdict: a later quiz edit cannot change a snapshot's scoring", () => {
    const originalLive = [
      {
        id: "q1",
        position: 0,
        prompt: "Which one is A?",
        points: 2,
        explanation: null,
        options: [
          { id: "o1", position: 0, text: "A", isCorrect: true },
          { id: "o2", position: 1, text: "B", isCorrect: false },
        ],
      },
    ];
    const snapshot = buildQuestionSnapshot(originalLive);
    const answers = [{ questionId: "q1", optionId: "o1" }];
    assert.equal(resolveSnapshotAnswers(snapshot, answers)[0].isCorrect, true);

    // Owner edits the live quiz: the key moves from A to B.
    const editedLive = [
      {
        ...originalLive[0],
        options: [
          { ...originalLive[0].options[0], isCorrect: false },
          { ...originalLive[0].options[1], isCorrect: true },
        ],
      },
    ];
    const editedSnapshot = buildQuestionSnapshot(editedLive);

    // The submitted attempt keeps its original verdict (snapshot-driven)...
    assert.equal(resolveSnapshotAnswers(snapshot, answers)[0].isCorrect, true);
    // ...while a NEW attempt on the edited quiz scores differently.
    assert.equal(resolveSnapshotAnswers(editedSnapshot, answers)[0].isCorrect, false);
  });

  it("maps resolved answers onto persisted QuizAnswer rows", () => {
    const resolved = resolveSnapshotAnswers(makeSnapshot(), [{ questionId: "q1", optionId: "o1" }]);
    assert.deepEqual(toQuizAnswerRows(resolved), [
      { questionId: "q1", optionId: "o1", isCorrect: true },
      { questionId: "q2", optionId: null, isCorrect: false },
    ]);
  });
});

describe("post-submission review rebuild", () => {
  it("rebuilds per-question results from the snapshot with the answer key", () => {
    const snapshot = makeSnapshot();
    const resolved = resolveSnapshotAnswers(snapshot, [
      { questionId: "q1", optionId: "o2" },
      { questionId: "q2", optionId: "o4" },
    ]);
    const questions = buildAttemptResultQuestions(snapshot, resolved);

    assert.equal(questions.length, 2);
    // q1 answered wrong: yourOptionId recorded, isCorrect false, key revealed.
    assert.equal(questions[0].yourOptionId, "o2");
    assert.equal(questions[0].isCorrect, false);
    assert.equal(questions[0].explanation, "A is the first letter.");
    assert.deepEqual(
      questions[0].options.map((option) => option.isCorrect),
      [true, false],
    );
    // q2 answered correctly.
    assert.equal(questions[1].yourOptionId, "o4");
    assert.equal(questions[1].isCorrect, true);
    assert.equal(questions[1].explanation, null);
  });

  it("shows an unanswered question with a null selection", () => {
    const questions = buildAttemptResultQuestions(makeSnapshot(), []);
    assert.equal(questions[0].yourOptionId, null);
    assert.equal(questions[0].isCorrect, false);
  });
});

describe("attempt lifecycle decisions", () => {
  it("enforces the attempt limit only when one is configured", () => {
    assert.equal(canStartQuizAttempt(0, null), true);
    assert.equal(canStartQuizAttempt(50, null), true);
    assert.equal(canStartQuizAttempt(2, 3), true);
    assert.equal(canStartQuizAttempt(3, 3), false);
    assert.equal(canStartQuizAttempt(4, 3), false);
  });

  it("reports remaining attempts, clamped at zero", () => {
    assert.equal(attemptsRemaining(0, null), null);
    assert.equal(attemptsRemaining(1, 3), 2);
    assert.equal(attemptsRemaining(3, 3), 0);
    assert.equal(attemptsRemaining(5, 3), 0);
  });

  it("computes the submit deadline from the quiz's time limit", () => {
    const now = new Date("2026-01-01T10:00:00.000Z");
    assert.equal(computeSubmitDeadline(now, null), null);
    const deadline = computeSubmitDeadline(now, 15);
    assert.ok(deadline);
    assert.equal(deadline.toISOString(), "2026-01-01T10:15:00.000Z");
  });

  it("rejects late submissions only after the deadline has passed", () => {
    const now = new Date("2026-01-01T10:00:00.000Z");
    assert.equal(isSubmitDeadlinePassed(null, now), false);
    assert.equal(isSubmitDeadlinePassed("2026-01-01T10:15:00.000Z", now), false);
    assert.equal(isSubmitDeadlinePassed("2026-01-01T09:59:59.999Z", now), true);
    // Exactly at the deadline the window is still open (strictly-before rule).
    assert.equal(isSubmitDeadlinePassed("2026-01-01T10:00:00.000Z", now), false);
  });
});

describe("attempt-state derivation", () => {
  const base = {
    submitDeadline: null,
    submittedAt: null,
    scorePercent: null,
    passed: null,
  };

  function row(overrides: Partial<AttemptStateRow>): AttemptStateRow {
    return {
      id: "a1",
      attemptNumber: 1,
      status: "STARTED",
      createdAt: "2026-01-01T10:00:00.000Z",
      ...base,
      ...overrides,
    };
  }

  it("starts from an empty slate", () => {
    assert.deepEqual(deriveQuizAttemptState([], 3), {
      attemptsUsed: 0,
      attemptsRemaining: 3,
      bestScorePercent: null,
      passed: false,
      activeAttempt: null,
      latestSubmitted: null,
    });
  });

  it("counts every attempt row as used and resumes the newest STARTED one", () => {
    const state = deriveQuizAttemptState(
      [
        row({ id: "a1", attemptNumber: 1, status: "EXPIRED" }),
        row({
          id: "a2",
          attemptNumber: 2,
          status: "STARTED",
          createdAt: "2026-01-02T10:00:00.000Z",
          submitDeadline: "2026-01-02T10:15:00.000Z",
        }),
      ],
      3,
    );
    assert.equal(state.attemptsUsed, 2);
    assert.equal(state.attemptsRemaining, 1);
    assert.deepEqual(state.activeAttempt, {
      id: "a2",
      attemptNumber: 2,
      startedAt: "2026-01-02T10:00:00.000Z",
      submitDeadline: "2026-01-02T10:15:00.000Z",
    });
  });

  it("reports the best score, any pass, and the latest submitted attempt", () => {
    const state = deriveQuizAttemptState(
      [
        row({
          id: "a1",
          attemptNumber: 1,
          status: "SUBMITTED",
          submittedAt: "2026-01-01T10:10:00.000Z",
          scorePercent: 40,
          passed: false,
        }),
        row({
          id: "a2",
          attemptNumber: 2,
          status: "SUBMITTED",
          submittedAt: "2026-01-02T10:10:00.000Z",
          scorePercent: 80,
          passed: true,
        }),
        row({ id: "a3", attemptNumber: 3, status: "EXPIRED" }),
      ],
      null,
    );
    assert.equal(state.attemptsUsed, 3);
    assert.equal(state.attemptsRemaining, null);
    assert.equal(state.bestScorePercent, 80);
    assert.equal(state.passed, true);
    assert.deepEqual(state.latestSubmitted, {
      id: "a2",
      submittedAt: "2026-01-02T10:10:00.000Z",
      scorePercent: 80,
      passed: true,
    });
    assert.equal(state.activeAttempt, null);
  });
});

describe("submission eligibility policy", () => {
  const fresh = { now: "2026-01-01T10:00:00.000Z", submissionsUsed: 0 };

  it("allows a fresh submission on an open-ended assignment", () => {
    assert.deepEqual(evaluateSubmissionEligibility({ ...fresh, dueAt: null, allowResubmission: false, hasOpenSubmission: false }), {
      canSubmit: true,
      blocker: null,
    });
  });

  it("blocks once the deadline has passed, even for a first submission", () => {
    assert.deepEqual(
      evaluateSubmissionEligibility({
        ...fresh,
        dueAt: "2026-01-01T09:59:59.000Z",
        allowResubmission: true,
        hasOpenSubmission: false,
      }),
      { canSubmit: false, blocker: "DEADLINE_PASSED" },
    );
    // Strictly-before rule: submitting exactly at the deadline is allowed.
    assert.deepEqual(
      evaluateSubmissionEligibility({
        ...fresh,
        dueAt: "2026-01-01T10:00:00.000Z",
        allowResubmission: true,
        hasOpenSubmission: false,
      }),
      { canSubmit: true, blocker: null },
    );
  });

  it("blocks a second submission when resubmission is disabled", () => {
    assert.deepEqual(
      evaluateSubmissionEligibility({
        ...fresh,
        submissionsUsed: 1,
        dueAt: null,
        allowResubmission: false,
        hasOpenSubmission: false,
      }),
      { canSubmit: false, blocker: "RESUBMISSION_NOT_ALLOWED" },
    );
  });

  it("allows a resubmission only when the previous one is graded or returned", () => {
    const policy = { submissionsUsed: 1, dueAt: null, allowResubmission: true };
    assert.deepEqual(evaluateSubmissionEligibility({ ...fresh, ...policy, hasOpenSubmission: true }), {
      canSubmit: false,
      blocker: "RESUBMISSION_NOT_ALLOWED",
    });
    assert.equal(
      evaluateSubmissionEligibility({ ...fresh, ...policy, hasOpenSubmission: false }).canSubmit,
      true,
    );
  });

  it("checks the deadline before the resubmission rules", () => {
    assert.deepEqual(
      evaluateSubmissionEligibility({
        now: "2026-01-02T00:00:00.000Z",
        dueAt: "2026-01-01T00:00:00.000Z",
        submissionsUsed: 1,
        allowResubmission: false,
        hasOpenSubmission: true,
      }),
      { canSubmit: false, blocker: "DEADLINE_PASSED" },
    );
  });
});

describe("grading validation", () => {
  it("accepts scores between 0 and maxPoints (integers only)", () => {
    assert.equal(isGradeScoreInRange(0, 100), true);
    assert.equal(isGradeScoreInRange(100, 100), true);
    assert.equal(isGradeScoreInRange(42, 100), true);
    assert.equal(isGradeScoreInRange(-1, 100), false);
    assert.equal(isGradeScoreInRange(101, 100), false);
    assert.equal(isGradeScoreInRange(1.5, 100), false);
  });
});

describe("assessment wire contracts", () => {
  const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

  it("parses submit bodies with unanswered questions", () => {
    const parsed = quizSubmitSchema.parse({
      answers: [
        { questionId: "q1", optionId: "o1" },
        { questionId: "q2", optionId: null },
      ],
    });
    assert.equal(parsed.answers[1].optionId, null);
    assert.throws(() => quizSubmitSchema.parse({ answers: [{ questionId: "q1", optionId: 3 }] }));
  });

  it("parses a review result built from the snapshot logic", () => {
    const snapshot = makeSnapshot();
    const resolved = resolveSnapshotAnswers(snapshot, [{ questionId: "q1", optionId: "o1" }]);
    const outcome = deriveQuizOutcome(2, 5, 70);
    const result = quizAttemptResultSchema.parse({
      id: UUID,
      attemptNumber: 1,
      status: "SUBMITTED",
      submittedAt: "2026-01-01T10:10:00.000Z",
      ...outcome,
      passPercent: 70,
      questions: buildAttemptResultQuestions(snapshot, resolved),
    });
    assert.equal(result.passed, false);
    assert.equal(result.questions[0].isCorrect, true);
    // The result schema may carry the answer key...
    assert.equal(result.questions[0].options[0].isCorrect, true);
  });

  it("parses a learner quiz view whose questions were sanitized", () => {
    const view = quizLearnerViewSchema.parse({
      lesson: { id: UUID, title: "Section Quiz" },
      quiz: {
        id: UUID,
        passPercent: 70,
        maxAttempts: 3,
        timeLimitMinutes: 15,
        questions: sanitizeQuizQuestions(makeSnapshot()),
      },
      myState: {
        attemptsUsed: 1,
        attemptsRemaining: 2,
        bestScorePercent: 40,
        passed: false,
        activeAttempt: {
          id: UUID,
          attemptNumber: 2,
          startedAt: "2026-01-02T10:00:00.000Z",
          submitDeadline: "2026-01-02T10:15:00.000Z",
          questions: sanitizeQuizQuestions(makeSnapshot()),
        },
        latestSubmitted: {
          id: UUID,
          submittedAt: "2026-01-01T10:10:00.000Z",
          scorePercent: 40,
          passed: false,
        },
      },
    });
    // The sanitized wire shape carries no answer key anywhere.
    const firstOption = view.myState.activeAttempt?.questions[0].options[0];
    assert.ok(firstOption);
    assert.equal("isCorrect" in firstOption, false);
  });

  it("rejects an authored quiz whose question has no correct option", () => {
    const valid = {
      passPercent: 70,
      maxAttempts: 3,
      timeLimitMinutes: 15,
      questions: [
        {
          prompt: "Pick one",
          points: 1,
          explanation: null,
          options: [
            { text: "A", isCorrect: true },
            { text: "B", isCorrect: false },
          ],
        },
      ],
    };
    assert.equal(quizAuthoringInputSchema.parse(valid).questions.length, 1);
    assert.throws(() =>
      quizAuthoringInputSchema.parse({
        ...valid,
        questions: [
          {
            ...valid.questions[0],
            options: [
              { text: "A", isCorrect: false },
              { text: "B", isCorrect: false },
            ],
          },
        ],
      }),
    );
  });

  it("coerces the grading queue query like the other list endpoints", () => {
    const parsed = gradingQueueQuerySchema.parse({ limit: "5", status: "SUBMITTED" });
    assert.equal(parsed.limit, 5);
    assert.equal(parsed.status, "SUBMITTED");
    assert.throws(() => gradingQueueQuerySchema.parse({ status: "PENDING" }));
  });
});
