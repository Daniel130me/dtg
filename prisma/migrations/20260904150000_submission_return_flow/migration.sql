-- "Return for revision" on assignment submissions: the owner sends work back
-- with feedback; the learner answers with a fresh attempt row.
ALTER TABLE "AssignmentSubmission" ADD COLUMN "returnedFeedback" VARCHAR(5000);
ALTER TABLE "AssignmentSubmission" ADD COLUMN "returnedAt" TIMESTAMP(3);
