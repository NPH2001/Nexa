import { z } from 'zod'

export const BANK_DOCUMENT_TYPES = [
  'national_id',
  'passport',
  'application_form',
  'proof_of_residence',
  'proof_of_income',
  'bank_statement',
  'other',
] as const
export const bankDocumentTypeSchema = z.enum(BANK_DOCUMENT_TYPES)
export type BankDocumentType = z.infer<typeof bankDocumentTypeSchema>

export const BANK_CHECKLIST_STATUSES = [
  'passed',
  'missing',
  'expired',
  'mismatch',
  'unreadable',
  'needs_review',
] as const
export const bankChecklistStatusSchema = z.enum(BANK_CHECKLIST_STATUSES)
export type BankChecklistStatus = z.infer<typeof bankChecklistStatusSchema>

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
const fieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/)

export const bankExtractedFieldSchema = z
  .object({
    key: fieldKeySchema,
    value: z.string().trim().min(1).max(1_000),
    sourceLabel: z.string().trim().min(1).max(200),
    needsReview: z.boolean().default(false),
  })
  .strict()
export type BankExtractedField = z.infer<typeof bankExtractedFieldSchema>

/** Output duy nhất model được phép tạo. Không có checklist status trong schema này. */
export const bankExtractionOutputSchema = z
  .object({
    documentType: bankDocumentTypeSchema,
    fields: z.array(bankExtractedFieldSchema).max(100),
    needsReview: z.boolean().default(false),
  })
  .strict()
export type BankExtractionOutput = z.infer<typeof bankExtractionOutputSchema>

/** Evidence đã gắn metadata tin cậy do main process tạo, không phải model. */
export const bankDocumentEvidenceSchema = bankExtractionOutputSchema.extend({
  id: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  sourcePathHash: z.string().regex(/^[a-f0-9]{64}$/),
  suspectedScan: z.boolean().default(false),
  truncated: z.boolean().default(false),
})
export type BankDocumentEvidence = z.infer<typeof bankDocumentEvidenceSchema>

export const bankChecklistRequirementSchema = z.object({
  id: identifierSchema,
  label: z.string().trim().min(1).max(200),
  acceptedDocumentTypes: z.array(bankDocumentTypeSchema).min(1),
  requiredFields: z.array(fieldKeySchema).max(30).default([]),
  expiryField: fieldKeySchema.optional(),
})
export type BankChecklistRequirement = z.infer<typeof bankChecklistRequirementSchema>

export const bankChecklistCrossCheckSchema = z.object({
  id: identifierSchema,
  label: z.string().trim().min(1).max(200),
  fieldKey: fieldKeySchema,
  documentTypes: z.array(bankDocumentTypeSchema).min(2),
})
export type BankChecklistCrossCheck = z.infer<typeof bankChecklistCrossCheckSchema>

export const bankChecklistTemplateSchema = z.object({
  id: identifierSchema,
  version: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200),
  caseType: identifierSchema,
  requirements: z.array(bankChecklistRequirementSchema).min(1).max(100),
  crossChecks: z.array(bankChecklistCrossCheckSchema).max(50).default([]),
})
export type BankChecklistTemplate = z.infer<typeof bankChecklistTemplateSchema>

export const bankChecklistEvidenceRefSchema = z.object({
  documentId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  fieldKey: fieldKeySchema.optional(),
  value: z.string().trim().min(1).max(1_000).optional(),
  sourceLabel: z.string().trim().min(1).max(200).optional(),
})
export type BankChecklistEvidenceRef = z.infer<typeof bankChecklistEvidenceRefSchema>

export const bankChecklistItemSchema = z.object({
  id: identifierSchema,
  label: z.string().trim().min(1).max(200),
  ruleId: z.string().trim().min(1).max(64),
  status: bankChecklistStatusSchema,
  message: z.string().trim().min(1).max(600),
  fix: z.string().trim().min(1).max(600),
  evidence: z.array(bankChecklistEvidenceRefSchema),
})
export type BankChecklistItem = z.infer<typeof bankChecklistItemSchema>

const statusCountsSchema = z.object({
  passed: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
  mismatch: z.number().int().nonnegative(),
  unreadable: z.number().int().nonnegative(),
  needs_review: z.number().int().nonnegative(),
})

export const bankChecklistReportSchema = z.object({
  rulePackId: z.string().trim().min(1).max(64),
  rulePackVersion: z.string().trim().min(1).max(32),
  templateId: identifierSchema,
  templateVersion: z.string().trim().min(1).max(32),
  reviewedAt: z.string().datetime(),
  items: z.array(bankChecklistItemSchema),
  counts: statusCountsSchema,
})
export type BankChecklistReport = z.infer<typeof bankChecklistReportSchema>
