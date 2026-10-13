-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('OWNER', 'FINANCE', 'ECOMMERCE', 'SALES_REP', 'OPERATIONS');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('QUICKBOOKS', 'METHOD_CRM', 'SHOPIFY', 'MONDAY');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTED', 'DEGRADED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'WEBHOOK', 'BACKFILL', 'RETRY');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerClassification" AS ENUM ('DIRECT', 'DISTRIBUTOR', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShopifyFinancialStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ShopifyFulfillmentStatus" AS ENUM ('UNFULFILLED', 'PARTIAL', 'FULFILLED', 'RESTOCKED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MetricApprovalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('PENDING', 'GENERATED', 'SENT', 'PARTIALLY_SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('UNMATCHED', 'AUTO_MATCHED', 'MANUALLY_MATCHED', 'IGNORED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "salesRepId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permission")
);

-- CreateTable
CREATE TABLE "UserDivision" (
    "userId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,

    CONSTRAINT "UserDivision_pkey" PRIMARY KEY ("userId","divisionId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySetting" (
    "id" TEXT NOT NULL DEFAULT 'company',
    "legalName" TEXT NOT NULL DEFAULT 'MetroLED',
    "displayName" TEXT NOT NULL DEFAULT 'MetroLED',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "fiscalYearStartMo" INTEGER NOT NULL DEFAULT 1,
    "briefSendHour" INTEGER NOT NULL DEFAULT 7,
    "briefSendMinute" INTEGER NOT NULL DEFAULT 0,
    "briefEnabled" BOOLEAN NOT NULL DEFAULT false,
    "staleDataHours" INTEGER NOT NULL DEFAULT 6,
    "staleQuoteDays" INTEGER NOT NULL DEFAULT 21,
    "largeQuoteAmount" DECIMAL(14,2) NOT NULL DEFAULT 10000,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "CompanySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Division" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DivisionMappingRule" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "field" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "matchValue" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "DivisionMappingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "credentials" JSONB,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "syncIntervalMin" INTEGER NOT NULL DEFAULT 180,
    "historyMonths" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "apiRequests" INTEGER NOT NULL DEFAULT 0,
    "rangeStart" TIMESTAMP(3),
    "rangeEnd" TIMESTAMP(3),
    "errorSummary" TEXT,
    "triggeredByUserId" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncError" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "sourceId" TEXT,
    "errorCode" TEXT,
    "message" TEXT NOT NULL,
    "isRetryable" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCheckpoint" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "cursor" TEXT,
    "lastRecordAt" TIMESTAMP(3),
    "backfillDoneTo" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "classification" "CustomerClassification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "divisionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSourceLink" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceEmail" TEXT,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'AUTO_MATCHED',
    "matchConfidence" INTEGER,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnmatchedRecord" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB,
    "suggestedCustomerId" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnmatchedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesRep" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "normalizedName" TEXT NOT NULL,
    "divisionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesRep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesRepSourceLink" (
    "id" TEXT NOT NULL,
    "salesRepId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesRepSourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceDocNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "divisionId" TEXT,
    "salesRepId" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "issuedOn" DATE NOT NULL,
    "dueOn" DATE,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revenueAmount" DECIMAL(14,2) NOT NULL,
    "costAmount" DECIMAL(14,2),
    "memo" TEXT,
    "sourceCreatedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT,
    "itemSourceId" TEXT,
    "itemName" TEXT,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "costAmount" DECIMAL(14,2),
    "divisionId" TEXT,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "customerId" TEXT,
    "receivedOn" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentApplication" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PaymentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceDocNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "divisionId" TEXT,
    "salesRepId" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'OPEN',
    "stage" TEXT NOT NULL,
    "stageNormalized" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "amount" DECIMAL(14,2) NOT NULL,
    "issuedOn" DATE NOT NULL,
    "expiresOn" DATE,
    "closedOn" DATE,
    "lastActivityAt" TIMESTAMP(3),
    "sourceCreatedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT,
    "itemName" TEXT,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyOrder" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "divisionId" TEXT,
    "email" TEXT,
    "financialStatus" "ShopifyFinancialStatus" NOT NULL DEFAULT 'UNKNOWN',
    "fulfillmentStatus" "ShopifyFulfillmentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "subtotalPrice" DECIMAL(14,2) NOT NULL,
    "totalDiscounts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalShipping" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalRefunded" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(14,2) NOT NULL,
    "netSalesAmount" DECIMAL(14,2) NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sourceLineId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "productSourceId" TEXT,
    "variantSourceId" TEXT,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ShopifyOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DivisionCost" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "cogsAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "sourceAccounts" JSONB,
    "basis" TEXT NOT NULL DEFAULT 'QBO_COGS_ACCOUNTS',
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DivisionCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CogsAccountMapping" (
    "id" TEXT NOT NULL,
    "sourceAccountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountType" TEXT,
    "includeInCogs" BOOLEAN NOT NULL DEFAULT false,
    "divisionId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CogsAccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "sourceSystems" TEXT[],
    "dateBasis" TEXT NOT NULL,
    "includedRecords" TEXT NOT NULL,
    "excludedRecords" TEXT NOT NULL,
    "currencyHandling" TEXT NOT NULL,
    "divisionMapping" TEXT NOT NULL,
    "approvalStatus" "MetricApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" TEXT NOT NULL,
    "metricDefinitionId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "divisionId" TEXT,
    "platformValue" DECIMAL(14,2) NOT NULL,
    "sourceValue" DECIMAL(14,2) NOT NULL,
    "variance" DECIMAL(14,2) NOT NULL,
    "variancePct" DECIMAL(9,4) NOT NULL,
    "tolerancePct" DECIMAL(9,4) NOT NULL DEFAULT 0.5,
    "passed" BOOLEAN NOT NULL,
    "performedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyBrief" (
    "id" TEXT NOT NULL,
    "briefDate" DATE NOT NULL,
    "status" "BriefStatus" NOT NULL DEFAULT 'PENDING',
    "generatedAt" TIMESTAMP(3),
    "payload" JSONB,
    "htmlBody" TEXT,
    "textBody" TEXT,
    "subject" TEXT,
    "dataWarnings" TEXT[],
    "generationMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefDelivery" (
    "id" TEXT NOT NULL,
    "dailyBriefId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BriefDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefRecipient" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "userId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BriefRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "sources" JSONB,
    "dataMode" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "model" TEXT,
    "refusalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "User_salesRepId_idx" ON "User"("salesRepId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permission_idx" ON "RolePermission"("permission");

-- CreateIndex
CREATE INDEX "UserDivision_divisionId_idx" ON "UserDivision"("divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Division_code_key" ON "Division"("code");

-- CreateIndex
CREATE INDEX "Division_isActive_sortOrder_idx" ON "Division"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "DivisionMappingRule_provider_isActive_priority_idx" ON "DivisionMappingRule"("provider", "isActive", "priority");

-- CreateIndex
CREATE INDEX "DivisionMappingRule_divisionId_idx" ON "DivisionMappingRule"("divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_provider_key" ON "Integration"("provider");

-- CreateIndex
CREATE INDEX "Integration_isEnabled_idx" ON "Integration"("isEnabled");

-- CreateIndex
CREATE INDEX "SyncRun_integrationId_startedAt_idx" ON "SyncRun"("integrationId", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRun_status_startedAt_idx" ON "SyncRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "SyncError_syncRunId_idx" ON "SyncError"("syncRunId");

-- CreateIndex
CREATE INDEX "SyncError_resolvedAt_idx" ON "SyncError"("resolvedAt");

-- CreateIndex
CREATE INDEX "SyncError_createdAt_idx" ON "SyncError"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCheckpoint_integrationId_entity_key" ON "SyncCheckpoint"("integrationId", "entity");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_idx" ON "WebhookEvent"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_integrationId_topic_externalId_key" ON "WebhookEvent"("integrationId", "topic", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Job_queue_status_idx" ON "Job"("queue", "status");

-- CreateIndex
CREATE INDEX "Customer_normalizedName_idx" ON "Customer"("normalizedName");

-- CreateIndex
CREATE INDEX "Customer_divisionId_idx" ON "Customer"("divisionId");

-- CreateIndex
CREATE INDEX "Customer_classification_idx" ON "Customer"("classification");

-- CreateIndex
CREATE INDEX "CustomerSourceLink_customerId_idx" ON "CustomerSourceLink"("customerId");

-- CreateIndex
CREATE INDEX "CustomerSourceLink_matchStatus_idx" ON "CustomerSourceLink"("matchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSourceLink_integrationId_sourceId_key" ON "CustomerSourceLink"("integrationId", "sourceId");

-- CreateIndex
CREATE INDEX "UnmatchedRecord_status_createdAt_idx" ON "UnmatchedRecord"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnmatchedRecord_integrationId_entity_sourceId_key" ON "UnmatchedRecord"("integrationId", "entity", "sourceId");

-- CreateIndex
CREATE INDEX "SalesRep_normalizedName_idx" ON "SalesRep"("normalizedName");

-- CreateIndex
CREATE INDEX "SalesRep_isActive_idx" ON "SalesRep"("isActive");

-- CreateIndex
CREATE INDEX "SalesRepSourceLink_salesRepId_idx" ON "SalesRepSourceLink"("salesRepId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesRepSourceLink_integrationId_sourceId_key" ON "SalesRepSourceLink"("integrationId", "sourceId");

-- CreateIndex
CREATE INDEX "Invoice_issuedOn_idx" ON "Invoice"("issuedOn");

-- CreateIndex
CREATE INDEX "Invoice_dueOn_idx" ON "Invoice"("dueOn");

-- CreateIndex
CREATE INDEX "Invoice_status_dueOn_idx" ON "Invoice"("status", "dueOn");

-- CreateIndex
CREATE INDEX "Invoice_divisionId_issuedOn_idx" ON "Invoice"("divisionId", "issuedOn");

-- CreateIndex
CREATE INDEX "Invoice_customerId_issuedOn_idx" ON "Invoice"("customerId", "issuedOn");

-- CreateIndex
CREATE INDEX "Invoice_salesRepId_issuedOn_idx" ON "Invoice"("salesRepId", "issuedOn");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_integrationId_sourceId_key" ON "Invoice"("integrationId", "sourceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_itemSourceId_idx" ON "InvoiceLine"("itemSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_lineNumber_key" ON "InvoiceLine"("invoiceId", "lineNumber");

-- CreateIndex
CREATE INDEX "Payment_receivedOn_idx" ON "Payment"("receivedOn");

-- CreateIndex
CREATE INDEX "Payment_customerId_receivedOn_idx" ON "Payment"("customerId", "receivedOn");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_integrationId_sourceId_key" ON "Payment"("integrationId", "sourceId");

-- CreateIndex
CREATE INDEX "PaymentApplication_invoiceId_idx" ON "PaymentApplication"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentApplication_paymentId_invoiceId_key" ON "PaymentApplication"("paymentId", "invoiceId");

-- CreateIndex
CREATE INDEX "Quote_status_issuedOn_idx" ON "Quote"("status", "issuedOn");

-- CreateIndex
CREATE INDEX "Quote_divisionId_status_idx" ON "Quote"("divisionId", "status");

-- CreateIndex
CREATE INDEX "Quote_salesRepId_status_idx" ON "Quote"("salesRepId", "status");

-- CreateIndex
CREATE INDEX "Quote_lastActivityAt_idx" ON "Quote"("lastActivityAt");

-- CreateIndex
CREATE INDEX "Quote_issuedOn_idx" ON "Quote"("issuedOn");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_integrationId_sourceId_key" ON "Quote"("integrationId", "sourceId");

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_quoteId_lineNumber_key" ON "QuoteLine"("quoteId", "lineNumber");

-- CreateIndex
CREATE INDEX "ShopifyOrder_placedAt_idx" ON "ShopifyOrder"("placedAt");

-- CreateIndex
CREATE INDEX "ShopifyOrder_financialStatus_placedAt_idx" ON "ShopifyOrder"("financialStatus", "placedAt");

-- CreateIndex
CREATE INDEX "ShopifyOrder_fulfillmentStatus_idx" ON "ShopifyOrder"("fulfillmentStatus");

-- CreateIndex
CREATE INDEX "ShopifyOrder_divisionId_placedAt_idx" ON "ShopifyOrder"("divisionId", "placedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrder_integrationId_sourceId_key" ON "ShopifyOrder"("integrationId", "sourceId");

-- CreateIndex
CREATE INDEX "ShopifyOrderLine_productSourceId_idx" ON "ShopifyOrderLine"("productSourceId");

-- CreateIndex
CREATE INDEX "ShopifyOrderLine_sku_idx" ON "ShopifyOrderLine"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrderLine_orderId_sourceLineId_key" ON "ShopifyOrderLine"("orderId", "sourceLineId");

-- CreateIndex
CREATE INDEX "DivisionCost_periodStart_idx" ON "DivisionCost"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "DivisionCost_divisionId_periodStart_key" ON "DivisionCost"("divisionId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "CogsAccountMapping_sourceAccountId_key" ON "CogsAccountMapping"("sourceAccountId");

-- CreateIndex
CREATE INDEX "CogsAccountMapping_includeInCogs_idx" ON "CogsAccountMapping"("includeInCogs");

-- CreateIndex
CREATE UNIQUE INDEX "MetricDefinition_key_key" ON "MetricDefinition"("key");

-- CreateIndex
CREATE INDEX "Reconciliation_metricDefinitionId_periodStart_idx" ON "Reconciliation"("metricDefinitionId", "periodStart");

-- CreateIndex
CREATE INDEX "Reconciliation_periodStart_idx" ON "Reconciliation"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "DailyBrief_briefDate_key" ON "DailyBrief"("briefDate");

-- CreateIndex
CREATE INDEX "DailyBrief_briefDate_idx" ON "DailyBrief"("briefDate");

-- CreateIndex
CREATE INDEX "BriefDelivery_status_idx" ON "BriefDelivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BriefDelivery_dailyBriefId_recipient_key" ON "BriefDelivery"("dailyBriefId", "recipient");

-- CreateIndex
CREATE UNIQUE INDEX "BriefRecipient_email_key" ON "BriefRecipient"("email");

-- CreateIndex
CREATE INDEX "BriefRecipient_isActive_idx" ON "BriefRecipient"("isActive");

-- CreateIndex
CREATE INDEX "AiConversation_userId_updatedAt_idx" ON "AiConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "SalesRep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDivision" ADD CONSTRAINT "UserDivision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDivision" ADD CONSTRAINT "UserDivision_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionMappingRule" ADD CONSTRAINT "DivisionMappingRule_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncError" ADD CONSTRAINT "SyncError_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCheckpoint" ADD CONSTRAINT "SyncCheckpoint_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSourceLink" ADD CONSTRAINT "CustomerSourceLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSourceLink" ADD CONSTRAINT "CustomerSourceLink_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnmatchedRecord" ADD CONSTRAINT "UnmatchedRecord_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRep" ADD CONSTRAINT "SalesRep_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRepSourceLink" ADD CONSTRAINT "SalesRepSourceLink_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "SalesRep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "SalesRep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentApplication" ADD CONSTRAINT "PaymentApplication_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentApplication" ADD CONSTRAINT "PaymentApplication_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "SalesRep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOrder" ADD CONSTRAINT "ShopifyOrder_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOrder" ADD CONSTRAINT "ShopifyOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOrder" ADD CONSTRAINT "ShopifyOrder_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOrderLine" ADD CONSTRAINT "ShopifyOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionCost" ADD CONSTRAINT "DivisionCost_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_metricDefinitionId_fkey" FOREIGN KEY ("metricDefinitionId") REFERENCES "MetricDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefDelivery" ADD CONSTRAINT "BriefDelivery_dailyBriefId_fkey" FOREIGN KEY ("dailyBriefId") REFERENCES "DailyBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefRecipient" ADD CONSTRAINT "BriefRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

