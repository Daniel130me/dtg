import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PAYMENT_AMOUNT_MISMATCH,
  PAYMENT_CURRENCY_MISMATCH,
} from "@/contracts/payments";
import {
  buildWebhookEventRef,
  checkPaymentEventMatchesOrder,
  classifyChargeEventStatus,
  describeOrderFulfilmentDecision,
  describeWebhookProcessingDecision,
  flutterwaveChargeWebhookSchema,
  flutterwaveRefundWebhookSchema,
  isWebhookSignatureValid,
  majorToMinorUnits,
  minorToMajorUnits,
} from "@/server/modules/payments/flutterwave.logic";

describe("webhook signature verification", () => {
  const expectedHash = "expected-verif-hash-value";

  it("accepts the exact expected hash", () => {
    assert.equal(isWebhookSignatureValid(expectedHash, expectedHash), true);
  });

  it("rejects tampered, different, empty, and missing hashes", () => {
    assert.equal(isWebhookSignatureValid(`${expectedHash}x`, expectedHash), false);
    assert.equal(isWebhookSignatureValid("a-different-hash", expectedHash), false);
    assert.equal(isWebhookSignatureValid("", expectedHash), false);
    assert.equal(isWebhookSignatureValid(null, expectedHash), false);
  });

  it("fails closed when no expected hash is configured", () => {
    assert.equal(isWebhookSignatureValid(expectedHash, ""), false);
    assert.equal(isWebhookSignatureValid(null, ""), false);
  });
});

describe("money unit conversion", () => {
  it("round-trips minor units through Flutterwave major units", () => {
    assert.equal(minorToMajorUnits(999_999), 9999.99);
    assert.equal(majorToMinorUnits(9999.99), 999_999);
    assert.equal(minorToMajorUnits(1050), 10.5);
    assert.equal(majorToMinorUnits(10.5), 1050);
  });

  it("avoids float drift on odd values", () => {
    for (const minor of [1, 5, 99, 100, 1_234, 44_990, 999_999, 4_499_005]) {
      assert.equal(majorToMinorUnits(minorToMajorUnits(minor)), minor);
    }
  });
});

describe("payment event matching", () => {
  const order = { totalMinor: 44_990, currency: "NGN" };

  it("accepts an exact match", () => {
    assert.deepEqual(
      checkPaymentEventMatchesOrder({
        eventAmountMinor: order.totalMinor,
        eventCurrency: order.currency,
        orderTotalMinor: order.totalMinor,
        orderCurrency: order.currency,
      }),
      { ok: true },
    );
  });

  it("rejects a tampered amount", () => {
    const result = checkPaymentEventMatchesOrder({
      eventAmountMinor: 100,
      eventCurrency: order.currency,
      orderTotalMinor: order.totalMinor,
      orderCurrency: order.currency,
    });
    assert.deepEqual(result, { ok: false, reason: PAYMENT_AMOUNT_MISMATCH });
  });

  it("rejects a currency mismatch", () => {
    const result = checkPaymentEventMatchesOrder({
      eventAmountMinor: order.totalMinor,
      eventCurrency: "USD",
      orderTotalMinor: order.totalMinor,
      orderCurrency: order.currency,
    });
    assert.deepEqual(result, { ok: false, reason: PAYMENT_CURRENCY_MISMATCH });
  });
});

describe("charge classification and webhook refs", () => {
  it("maps provider charge statuses onto the fulfilment vocabulary", () => {
    assert.equal(classifyChargeEventStatus("successful"), "SUCCESSFUL");
    assert.equal(classifyChargeEventStatus("failed"), "FAILED");
    assert.equal(classifyChargeEventStatus("cancelled"), "FAILED");
    assert.equal(classifyChargeEventStatus("abandoned"), "UNKNOWN");
  });

  it("builds the (provider, providerRef) dedupe ref", () => {
    assert.equal(buildWebhookEventRef("charge.completed", 12_345), "charge.completed:12345");
  });
});

describe("webhook processing decisions", () => {
  it("skips only PROCESSED redeliveries", () => {
    assert.equal(describeWebhookProcessingDecision({ status: "PROCESSED" }), "SKIP");
    assert.equal(describeWebhookProcessingDecision({ status: "RECEIVED" }), "RETRY");
    assert.equal(describeWebhookProcessingDecision({ status: "FAILED" }), "RETRY");
    assert.equal(describeWebhookProcessingDecision({ status: "IGNORED" }), "RETRY");
    assert.equal(describeWebhookProcessingDecision(null), "RETRY");
  });
});

describe("order fulfilment decisions", () => {
  it("fulfils only pending orders", () => {
    assert.equal(describeOrderFulfilmentDecision("PENDING"), "FULFIL");
  });

  it("treats reordered or duplicate events on paid orders as no-ops", () => {
    assert.equal(describeOrderFulfilmentDecision("PAID"), "ALREADY_FULFILLED");
  });

  it("rejects terminal-failure states", () => {
    assert.equal(describeOrderFulfilmentDecision("FAILED"), "REJECT");
    assert.equal(describeOrderFulfilmentDecision("CANCELLED"), "REJECT");
    assert.equal(describeOrderFulfilmentDecision("REFUNDED"), "REJECT");
  });
});

describe("webhook payload schemas", () => {
  const validCharge = {
    event: "charge.completed",
    data: {
      id: 12345,
      tx_ref: "6f1a2b3c-0000-4000-8000-000000000001",
      status: "successful",
      amount: 4499,
      currency: "NGN",
    },
  };

  it("accepts well-formed charge payloads", () => {
    const parsed = flutterwaveChargeWebhookSchema.parse(validCharge);
    assert.equal(parsed.data.id, 12345);
    assert.equal(parsed.data.currency, "NGN");
  });

  it("rejects malformed charge payloads", () => {
    assert.throws(() => flutterwaveChargeWebhookSchema.parse({ data: validCharge.data }));
    assert.throws(() =>
      flutterwaveChargeWebhookSchema.parse({
        event: "charge.completed",
        data: { ...validCharge.data, id: 0 },
      }),
    );
    assert.throws(() =>
      flutterwaveChargeWebhookSchema.parse({
        event: "charge.completed",
        data: { ...validCharge.data, id: "12345" },
      }),
    );
    assert.throws(() =>
      flutterwaveChargeWebhookSchema.parse({
        event: "charge.completed",
        data: { ...validCharge.data, amount: -1 },
      }),
    );
  });

  it("accepts well-formed refund payloads", () => {
    const parsed = flutterwaveRefundWebhookSchema.parse({
      event: "refund.completed",
      data: { id: 555, status: "completed", transaction_id: 12345 },
    });
    assert.equal(parsed.data.transaction_id, 12345);
  });

  it("rejects malformed refund payloads", () => {
    assert.throws(() =>
      flutterwaveRefundWebhookSchema.parse({
        event: "refund.completed",
        data: { status: "completed", transaction_id: 12345 },
      }),
    );
    assert.throws(() =>
      flutterwaveRefundWebhookSchema.parse({
        event: "refund.completed",
        data: { id: 555, status: "completed", transaction_id: "12345" },
      }),
    );
  });
});
