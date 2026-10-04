-- DropForeignKey
ALTER TABLE "addresses" DROP CONSTRAINT "addresses_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "allocations" DROP CONSTRAINT "allocations_booking_id_fkey";

-- DropForeignKey
ALTER TABLE "allocations" DROP CONSTRAINT "allocations_driver_id_fkey";

-- DropForeignKey
ALTER TABLE "allocations" DROP CONSTRAINT "allocations_vehicle_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_id_fkey";

-- DropForeignKey
ALTER TABLE "booking_attempts" DROP CONSTRAINT "booking_attempts_booking_id_fkey";

-- DropForeignKey
ALTER TABLE "booking_attempts" DROP CONSTRAINT "booking_attempts_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "booking_requests" DROP CONSTRAINT "booking_requests_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "booking_requests" DROP CONSTRAINT "booking_requests_handled_by_id_fkey";

-- DropForeignKey
ALTER TABLE "booking_stops" DROP CONSTRAINT "booking_stops_booking_fk";

-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_cancelled_by_id_fkey";

-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_city_id_fkey";

-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_corporate_account_id_fkey";

-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_corporate_account_id_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_user_id_fkey";

-- DropForeignKey
ALTER TABLE "device_tokens" DROP CONSTRAINT "device_tokens_user_id_fkey";

-- DropForeignKey
ALTER TABLE "discount_redemptions" DROP CONSTRAINT "discount_redemptions_discount_id_fkey";

-- DropForeignKey
ALTER TABLE "drivers" DROP CONSTRAINT "drivers_assigned_vehicle_id_fkey";

-- DropForeignKey
ALTER TABLE "drivers" DROP CONSTRAINT "drivers_user_id_fkey";

-- DropForeignKey
ALTER TABLE "fare_configs" DROP CONSTRAINT "fare_configs_city_id_fkey";

-- DropForeignKey
ALTER TABLE "idempotency_keys" DROP CONSTRAINT "idempotency_keys_user_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_booking_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_corporate_account_id_fkey";

-- DropForeignKey
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_booking_id_fkey";

-- DropForeignKey
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_user_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_booking_id_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_fkey";

-- DropForeignKey
ALTER TABLE "rental_packages" DROP CONSTRAINT "rental_packages_city_id_fkey";

-- DropForeignKey
ALTER TABLE "trip_events" DROP CONSTRAINT "trip_events_booking_id_fkey";

-- DropForeignKey
ALTER TABLE "trip_reviews" DROP CONSTRAINT "trip_reviews_booking_fk";

-- DropForeignKey
ALTER TABLE "trip_reviews" DROP CONSTRAINT "trip_reviews_customer_fk";

-- DropForeignKey
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_city_id_fkey";

-- DropTable
DROP TABLE "addresses";

-- DropTable
DROP TABLE "allocations";

-- DropTable
DROP TABLE "audit_logs";

-- DropTable
DROP TABLE "booking_attempts";

-- DropTable
DROP TABLE "booking_requests";

-- DropTable
DROP TABLE "booking_stops";

-- DropTable
DROP TABLE "bookings";

-- DropTable
DROP TABLE "cities";

-- DropTable
DROP TABLE "contacts";

-- DropTable
DROP TABLE "corporate_accounts";

-- DropTable
DROP TABLE "customers";

-- DropTable
DROP TABLE "device_tokens";

-- DropTable
DROP TABLE "discount_redemptions";

-- DropTable
DROP TABLE "discounts";

-- DropTable
DROP TABLE "drivers";

-- DropTable
DROP TABLE "fare_configs";

-- DropTable
DROP TABLE "gst_config";

-- DropTable
DROP TABLE "idempotency_keys";

-- DropTable
DROP TABLE "invoice_lines";

-- DropTable
DROP TABLE "invoices";

-- DropTable
DROP TABLE "ledger_entries";

-- DropTable
DROP TABLE "payments";

-- DropTable
DROP TABLE "refresh_tokens";

-- DropTable
DROP TABLE "rental_packages";

-- DropTable
DROP TABLE "role_permissions";

-- DropTable
DROP TABLE "service_areas";

-- DropTable
DROP TABLE "service_states";

-- DropTable
DROP TABLE "surge_rules";

-- DropTable
DROP TABLE "trip_events";

-- DropTable
DROP TABLE "trip_reviews";

-- DropTable
DROP TABLE "users";

-- DropTable
DROP TABLE "vehicle_catalog";

-- DropTable
DROP TABLE "vehicles";

-- DropTable
DROP TABLE "webhook_events";

-- DropEnum
DROP TYPE "AccountType";

-- DropEnum
DROP TYPE "AllocationStatus";

-- DropEnum
DROP TYPE "AreaTier";

-- DropEnum
DROP TYPE "AttemptOutcome";

-- DropEnum
DROP TYPE "BillingCycle";

-- DropEnum
DROP TYPE "BookingRequestStatus";

-- DropEnum
DROP TYPE "BookingStatus";

-- DropEnum
DROP TYPE "CancelledBy";

-- DropEnum
DROP TYPE "ContactStatus";

-- DropEnum
DROP TYPE "DiscountScope";

-- DropEnum
DROP TYPE "DiscountType";

-- DropEnum
DROP TYPE "IdempotencyStatus";

-- DropEnum
DROP TYPE "InvoiceStatus";

-- DropEnum
DROP TYPE "InvoiceType";

-- DropEnum
DROP TYPE "KycStatus";

-- DropEnum
DROP TYPE "LedgerDirection";

-- DropEnum
DROP TYPE "LedgerEntryType";

-- DropEnum
DROP TYPE "PaymentMethod";

-- DropEnum
DROP TYPE "PaymentMode";

-- DropEnum
DROP TYPE "PaymentStatus";

-- DropEnum
DROP TYPE "Role";

-- DropEnum
DROP TYPE "TripType";

-- DropEnum
DROP TYPE "VehicleStatus";

-- CreateTable
CREATE TABLE "bot_customers" (
    "id" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "customerType" TEXT NOT NULL DEFAULT 'RETAIL',
    "companyName" TEXT,
    "gstNumber" TEXT,
    "lastInteractionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_sessions" (
    "id" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "language" TEXT,
    "state" TEXT NOT NULL DEFAULT 'LANGUAGE_SELECTION',
    "previousState" TEXT,
    "draft" JSONB NOT NULL DEFAULT '{}',
    "activeBookingId" TEXT,
    "activePaymentId" TEXT,
    "pendingIdempotencyKey" TEXT,
    "pendingOptionsMap" JSONB NOT NULL DEFAULT '{}',
    "humanHandoff" BOOLEAN NOT NULL DEFAULT false,
    "handoffReason" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_vehicles" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "seatingCapacity" INTEGER NOT NULL,
    "ac" BOOLEAN NOT NULL DEFAULT true,
    "supportedTripTypes" JSONB NOT NULL DEFAULT '[]',
    "baseFarePerKm" DOUBLE PRECISION NOT NULL,
    "baseFarePerHour" DOUBLE PRECISION,
    "driverAllowancePerDay" DOUBLE PRECISION NOT NULL DEFAULT 300,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_bookings" (
    "id" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "customerId" TEXT NOT NULL,
    "passenger" JSONB NOT NULL,
    "customerType" TEXT NOT NULL DEFAULT 'RETAIL',
    "companyName" TEXT,
    "gstNumber" TEXT,
    "tripType" TEXT NOT NULL,
    "pickup" JSONB NOT NULL,
    "drop" JSONB,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "returnAt" TIMESTAMP(3),
    "rentalHours" INTEGER,
    "vehicle" JSONB NOT NULL,
    "fare" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "driver" JSONB,
    "liveLocation" JSONB,
    "paymentId" TEXT,
    "cancellation" JSONB,
    "invoiceUrl" TEXT,
    "specialRequests" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_payments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_support_tickets" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "name" TEXT,
    "bookingId" TEXT,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_processed_messages" (
    "id" TEXT NOT NULL,
    "whatsappMessageId" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_processed_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_abandoned_bookings" (
    "id" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "abandonedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followUpSentAt" TIMESTAMP(3),
    "recovered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_abandoned_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_customers_whatsappNumber_key" ON "bot_customers"("whatsappNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bot_sessions_whatsappNumber_key" ON "bot_sessions"("whatsappNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bot_vehicles_vehicleId_key" ON "bot_vehicles"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_bookings_bookingNumber_key" ON "bot_bookings"("bookingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bot_bookings_paymentId_key" ON "bot_bookings"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_bookings_idempotencyKey_key" ON "bot_bookings"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "bot_payments_razorpayOrderId_key" ON "bot_payments"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_payments_idempotencyKey_key" ON "bot_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "bot_payments_bookingId_idx" ON "bot_payments"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_processed_messages_whatsappMessageId_key" ON "bot_processed_messages"("whatsappMessageId");

-- AddForeignKey
ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "bot_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_bookings" ADD CONSTRAINT "bot_bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "bot_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_bookings" ADD CONSTRAINT "bot_bookings_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "bot_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_support_tickets" ADD CONSTRAINT "bot_support_tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "bot_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
