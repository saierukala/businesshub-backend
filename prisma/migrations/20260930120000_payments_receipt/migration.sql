-- AlterTable: a receipt number for each recorded payment (RC-YYYY-00001)
ALTER TABLE "Payment" ADD COLUMN "receiptNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- The DATABASE guarantees a booking is paid at most once, even if two requests record a payment at the
-- same instant. (Failed or refunded rows do not count: only PAID is unique per booking.)
CREATE UNIQUE INDEX "payment_one_paid_per_booking" ON "Payment"("bookingId") WHERE "status" = 'PAID';

-- A payment is always for a positive amount.
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_positive" CHECK ("amount" > 0);
