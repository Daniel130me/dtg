-- One purchase line (order item) maps to at most one enrolment.
CREATE UNIQUE INDEX "Enrolment_orderItemId_key" ON "Enrolment"("orderItemId");
